import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError } from "../../../lib/rentcast";
import { loadComps } from "../../../lib/comps";
import { AiLimitError, recommend } from "../../../lib/recommend";
import { distanceMiles, fetchRadiusFor } from "../../results/geo";

// The AI call can take a while.
export const maxDuration = 60;

// POST /api/recommend { lat, lng, radiusMiles, mode, address }
// The server rebuilds the listing data itself (from the RentCast cache) rather
// than trusting data sent by the browser.
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

    const result = await recommend({
      mode,
      subjectAddress: address,
      estimate,
      listings: nearby,
      radiusMiles,
      userId,
    });
    return Response.json(result);
  } catch (err) {
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
