import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError } from "../../../lib/rentcast";
import { loadComps } from "../../../lib/comps";
import { getUserPlan } from "../../../lib/plans";
import { commuteLimitFor, ensureSearchAccess, PaymentRequired, planUsage, searchKeyFor } from "../../../lib/access";
import { demoAt } from "../../../lib/demo";
import { FETCH_RADII_MILES } from "../../results/geo";

// GET /api/comps?lat=..&lng=..&radius=5&mode=rent|buy&address=..
// Returns the property's estimated rent or value plus active listings nearby,
// for a search the user has unlocked (402 with a price when they haven't).
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });

  if (!sql || !process.env.RENTCAST_API_KEY) {
    return Response.json(
      { error: "Property data isn't set up on this server yet." },
      { status: 503 }
    );
  }

  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const radius = Number(params.get("radius"));
  const mode = params.get("mode") === "buy" ? "buy" : "rent";
  const address = (params.get("address") || "").replace(/,\s*USA$/, "").slice(0, 200);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid location." }, { status: 400 });
  }
  if (!FETCH_RADII_MILES.includes(radius)) {
    return Response.json({ error: "Invalid radius." }, { status: 400 });
  }

  try {
    // This week's demo is open to every account; anything else needs an
    // unlocked search (paid, or one of the plan's searches).
    const demoWeek = await demoAt(lat, lng);
    const demo = Boolean(demoWeek);
    const access = await getUserPlan(userId);
    const unlocked = demo ? { source: "demo" } : await ensureSearchAccess(userId, access, searchKeyFor(lat, lng, mode));

    const { estimate, listings, listingsFetchedAt } = await loadComps({
      lat,
      lng,
      // The demo always uses its own (shared, weekly) listings around the city point.
      fetchRadius: demo ? 5 : radius,
      mode,
      address: demo ? demoWeek.address : address,
      userId,
      addressesPerDay: access.plan.newAddressesPerDay,
      ...(demo && { listingsCenter: demoWeek.center, excludeAddress: demoWeek.address }),
    });
    // After unlocking, so this search is already counted.
    const usage = demo ? null : await planUsage(userId, access);
    return Response.json({
      mode,
      fetchRadius: radius,
      estimate,
      listings,
      listingsFetchedAt,
      access: {
        source: unlocked.source,
        demo,
        tier: access.tier,
        aiIncludedLeft: unlocked.pass ? !unlocked.pass.ai_included_used : unlocked.source !== "demo",
        commuteLimit: commuteLimitFor(access, { demo }),
        usage,
      },
    });
  } catch (err) {
    if (err instanceof PaymentRequired) {
      return Response.json({ error: err.message, payment: err.payment }, { status: 402 });
    }
    if (err instanceof BudgetError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    console.error("Comps lookup failed:", err);
    return Response.json({ error: "Couldn't load property data. Try again later." }, { status: 502 });
  }
}
