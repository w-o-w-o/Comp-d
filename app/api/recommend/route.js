import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError } from "../../../lib/rentcast";
import { loadComps } from "../../../lib/comps";
import { AiLimitError, MAX_LISTINGS, recommend } from "../../../lib/recommend";
import { amenitySummary, areaProfile, floodZones } from "../../../lib/area";
import { getUserPlan } from "../../../lib/plans";
import { distanceMiles, fetchRadiusFor } from "../../results/geo";

// Area lookups plus the AI call can take a while.
export const maxDuration = 90;

const TRAVEL_MODES = ["DRIVING", "TRANSIT", "BICYCLING", "WALKING"];

// Commute times computed in the browser (Google Routes), checked for shape.
function parseCommute(c) {
  if (!c || typeof c !== "object" || !TRAVEL_MODES.includes(c.travelMode)) return null;
  const minutes = (v) => (Number.isFinite(v) && v >= 0 && v < 1440 ? Math.round(v) : null);
  const byListing = {};
  for (const [id, v] of Object.entries(c.byListing || {}).slice(0, 100)) {
    byListing[String(id).slice(0, 200)] = minutes(v);
  }
  return {
    destination: String(c.destination || "").slice(0, 200),
    travelMode: c.travelMode,
    subjectMinutes: minutes(c.subjectMinutes),
    byListing,
  };
}

// POST /api/recommend { lat, lng, radiusMiles, mode, address, commute? }
// The server rebuilds the listing and area data itself (from caches) rather
// than trusting data sent by the browser; only commute times come from it.
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });

  if (!sql || !process.env.RENTCAST_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "AI recommendations aren't set up on this server yet." },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusMiles = Number(body.radiusMiles);
  const mode = body.mode === "buy" ? "buy" : "rent";
  const address = String(body.address || "").replace(/,\s*USA$/, "").slice(0, 200);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid location." }, { status: 400 });
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 25) {
    return Response.json({ error: "Invalid radius." }, { status: 400 });
  }

  const { tier, plan } = await getUserPlan(userId);
  if (plan.aiPerDay === 0) {
    return Response.json(
      { error: "AI recommendations are included with Basic and Advanced.", upgradeTo: "basic" },
      { status: 402 }
    );
  }

  try {
    const { estimate, listings } = await loadComps({
      lat,
      lng,
      fetchRadius: fetchRadiusFor(radiusMiles),
      mode,
      address,
      userId,
    });

    const position = { lat, lng };
    const nearby = listings
      .map((l) => ({ ...l, distance: distanceMiles(position, l) }))
      .filter((l) => l.distance <= radiusMiles)
      .sort((a, b) => a.distance - b.distance);

    if (nearby.length === 0) {
      return Response.json({ error: "There are no listings in this radius to compare." }, { status: 422 });
    }

    // Public area data, plus walkability and flood zone for each listing the AI sees.
    const considered = nearby.slice(0, MAX_LISTINGS);
    const { pois, ...area } = await areaProfile({
      lat,
      lng,
      address,
      radiusMiles,
      listingZips: considered.map((l) => l.zip),
    });
    const floods = await floodZones(considered);
    const enriched = considered.map((l, i) => ({
      ...l,
      amenities: amenitySummary(pois, l),
      floodRisk: floods[i]?.risk ?? null,
    }));

    const result = await recommend({
      mode,
      subjectAddress: address,
      estimate,
      listings: enriched,
      area,
      commute: parseCommute(body.commute),
      radiusMiles,
      userId,
      dailyLimit: plan.aiPerDay,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof AiLimitError && tier === "basic") {
      return Response.json(
        { error: `${err.message} Advanced includes more each day.`, upgradeTo: "advanced" },
        { status: 429 }
      );
    }
    if (err instanceof BudgetError || err instanceof AiLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "The AI is busy right now. Try again in a minute." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic API key rejected:", err.message);
      return Response.json({ error: "AI recommendations aren't set up correctly." }, { status: 503 });
    }
    console.error("AI recommendation failed:", err);
    return Response.json({ error: "Couldn't get an AI recommendation. Try again later." }, { status: 502 });
  }
}
