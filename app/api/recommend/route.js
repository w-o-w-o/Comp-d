import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError } from "../../../lib/rentcast";
import { loadComps } from "../../../lib/comps";
import { AiLimitError, MAX_LISTINGS, recommend } from "../../../lib/recommend";
import { areaProfile, floodZones, schoolDistances, walkabilities } from "../../../lib/area";
import { getUserPlan } from "../../../lib/plans";
import { parseNearby } from "../../../lib/nearby";
import { getSavedAmenities } from "../../../lib/amenities";
import { addressKey } from "../../results/amenities";
import { distanceMiles, fetchRadiusFor } from "../../results/geo";
import { defaultFilters, matchesFilters, medianPricePerSqft, parseFilters } from "../../results/quality";
import { claimAnalysis, ensureSearchAccess, PaymentRequired, planUsage, searchKeyFor } from "../../../lib/access";
import { demoAt } from "../../../lib/demo";
import { tabSummary } from "../../../lib/tabs";
import { analysisLabel, saveAnalysis } from "../../../lib/analyses";
import { hiddenListings, reasonsForAi } from "../../../lib/hidden";
import {
  checkListing,
  describePreferences,
  monthlyPayment,
  parsePreferences,
} from "../../results/preferences";

// Area lookups plus the AI call (with web research for rentals) can take a
// few minutes.
export const maxDuration = 300;

// With a "Walkable" priority, how many of the nearest homes get their own
// walkability lookup before picking which homes the AI sees.
const WALK_CHECK_LIMIT = 100;

const TRAVEL_MODES =["DRIVING", "TRANSIT", "BICYCLING", "WALKING"];

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


// POST /api/recommend { lat, lng, radiusMiles, mode, address, commute?, nearby? }
// The server rebuilds the listing and area data itself (from caches) rather
// than trusting data sent by the browser; only commute times and nearby-place
// counts come from it (both need the browser's Google key).
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

  const access = await getUserPlan(userId);
  const demoWeek = await demoAt(lat, lng);

  try {
    // Only for a search the user has unlocked (or this week's demo), before
    // anything is loaded, so a locked search can't trigger data lookups.
    if (!demoWeek) await ensureSearchAccess(userId, access, searchKeyFor(lat, lng, mode));

    const { estimate, listings } = await loadComps({
      lat,
      lng,
      fetchRadius: demoWeek ? 5 : fetchRadiusFor(radiusMiles),
      mode,
      address: demoWeek ? demoWeek.address : address,
      userId,
      addressesPerDay: access.plan.newAddressesPerDay,
      ...(demoWeek && { listingsCenter: demoWeek.center, excludeAddress: demoWeek.address }),
    });

    // Same homes the user sees: inside the radius and matching their filters,
    // minus the ones they said "not for me" to.
    const filters = parseFilters(body.filters);
    const position = { lat, lng };
    const hidden = demoWeek ? [] : await hiddenListings(userId, mode).catch(() => []);
    const hiddenIds = new Set(hidden.map((h) => h.listingId));
    const nearby = listings
      .filter((l) => !hiddenIds.has(l.id))
      .filter((l) => matchesFilters(l, filters))
      .map((l) => ({ ...l, distance: distanceMiles(position, l) }))
      .filter((l) => l.distance <= radiusMiles)
      .sort((a, b) => a.distance - b.distance);

    if (nearby.length === 0) {
      return Response.json(
        {
          error: hidden.length
            ? "There are no listings left in this radius that match your filters and that you haven't hidden."
            : "There are no listings in this radius that match your filters.",
        },
        { status: 422 }
      );
    }

    const commute = parseCommute(body.commute);
    const median = medianPricePerSqft(nearby);
    const ctx = { radiusMiles, commute, medianPpsf: median?.median ?? null };
    const priorities = parsePreferences(body.priorities, mode, ctx);
    const wants = (id) => priorities?.items.some((p) => p.id === id);

    // Public area data for the subject (also lists the schools around it).
    const profile = await areaProfile({ lat, lng, address, listingZips: nearby.slice(0, MAX_LISTINGS).map((l) => l.zip) });

    // Per-home facts the priorities check: distance to schools (computed
    // here), and walkability (one EPA lookup per spot, so only for the
    // nearest homes, and only when the user asked for it).
    // Rental amenities already looked up on the web (saved for 7 days).
    const savedAmenities =
      mode === "rent" ? await getSavedAmenities([address, ...nearby.map((l) => l.address)]) : new Map();
    const subjectAmenities = savedAmenities.get(addressKey(address)) || null;

    let withFacts = nearby.map((l) => ({
      ...l,
      schoolMiles: schoolDistances(l, position, profile.schools),
      ...(savedAmenities.has(addressKey(l.address)) && { amenities: savedAmenities.get(addressKey(l.address)) }),
    }));
    if (wants("walkable")) {
      const head = withFacts.slice(0, WALK_CHECK_LIMIT);
      const scores = await walkabilities(head);
      withFacts = [...head.map((l, i) => ({ ...l, walkScore: scores[i]?.score ?? null })), ...withFacts.slice(WALK_CHECK_LIMIT)];
    }

    // The AI sees at most MAX_LISTINGS homes. With must-haves, send the ones
    // that meet them first (then nearest), so a strict budget doesn't leave the
    // AI with only homes it can't recommend.
    const mustHaves = priorities && {
      items: priorities.items.filter((p) => p.must),
      custom: [],
    };
    const mustMisses = (l) => (mustHaves?.items.length ? checkListing(l, mustHaves, mode, ctx).misses.length : 0);
    const considered = withFacts
      .map((l) => ({ l, misses: mustMisses(l) }))
      .sort((a, b) => a.misses - b.misses || a.l.distance - b.l.distance)
      .slice(0, MAX_LISTINGS)
      .map(({ l }) => l);

    // The flood zone and walkability of each listing the AI sees.
    const [floods, walks] = await Promise.all([
      floodZones(considered),
      walkabilities(considered.filter((l) => l.walkScore === undefined)),
    ]);
    let w = 0;
    for (const l of considered) if (l.walkScore === undefined) l.walkScore = walks[w++]?.score ?? null;
    const area = { ...profile, amenities: parseNearby(body.nearby), typicalPricePerSqft: median?.median ?? null };

    // Check each listing against the user's priorities here, so the AI gets
    // exact answers instead of doing the arithmetic itself.
    const payment = priorities?.items.find((p) => p.id === "payment")?.value;
    const people = priorities?.items.find((p) => p.id === "roommates")?.value;
    const enriched = considered.map((l, i) => {
      const listing = { ...l, floodRisk: floods[i]?.risk ?? null };
      if (!priorities) return listing;
      const { misses, unknown } = checkListing(listing, priorities, mode, ctx);
      return {
        ...listing,
        missesPriorities: misses,
        priorityDataMissing: unknown,
        ...(payment && { estMonthlyPayment: monthlyPayment(l.price, payment, l.hoaFee) }),
        ...(people && { rentPerPerson: Math.round(l.price / people) }),
      };
    });
    const subjectEstimate = estimate?.amount;
    const subjectExtras =
      priorities && subjectEstimate
        ? {
            ...(payment && { estMonthlyPayment: monthlyPayment(subjectEstimate, payment, 0) }),
            ...(people && { rentPerPerson: Math.round(subjectEstimate / people) }),
          }
        : null;

    // In the demo, the analysis with no priorities and the default filters
    // (and at most the preset commute) is the shared, free one.
    const defaults = defaultFilters(estimate?.subject);
    const demo = demoWeek && {
      week: demoWeek.week,
      isDefault:
        !priorities &&
        JSON.stringify(filters ?? defaults) === JSON.stringify(defaults) &&
        (!commute || commute.destination === demoWeek.commuteTo),
    };
    const searchKey = searchKeyFor(lat, lng, mode);
    const result = await recommend({
      mode,
      subjectAddress: address,
      estimate,
      listings: enriched,
      area,
      commute,
      filters,
      priorities: describePreferences(priorities, mode),
      subjectExtras,
      subjectAmenities,
      dislikes: reasonsForAi(hidden),
      radiusMiles,
      userId,
      claim: () => claimAnalysis(userId, access, searchKey, { demo }),
    });
    // Kept in the user's list of analyses to look back on (a failure here
    // shouldn't cost them the result).
    await saveAnalysis({
      userId,
      searchKey,
      address: demoWeek ? demoWeek.address : address,
      mode,
      radiusMiles,
      demo: Boolean(demoWeek),
      label: analysisLabel(describePreferences(priorities, mode)),
      result,
      listings: enriched,
    }).catch((err) => console.error("Couldn't save the analysis:", err.message));

    // The plan's count after this analysis, so the page stays up to date.
    const [usage, tab] = demoWeek || access.fullAccess
      ? [null, null]
      : await Promise.all([planUsage(userId, access), tabSummary(userId)]);
    return Response.json({ ...result, usage, tab });
  } catch (err) {
    if (err instanceof PaymentRequired) {
      return Response.json({ error: err.message, payment: err.payment }, { status: 402 });
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
