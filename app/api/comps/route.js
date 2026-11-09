import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError } from "../../../lib/rentcast";
import { loadComps } from "../../../lib/comps";
import { FETCH_RADII_MILES } from "../../results/geo";

// GET /api/comps?lat=..&lng=..&radius=5&mode=rent|buy&address=..
// Returns the property's estimated rent or value plus active listings nearby.
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
    const { estimate, listings } = await loadComps({
      lat,
      lng,
      fetchRadius: radius,
      mode,
      address,
      userId,
    });
    return Response.json({ mode, fetchRadius: radius, estimate, listings });
  } catch (err) {
    if (err instanceof BudgetError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    console.error("Comps lookup failed:", err);
    return Response.json({ error: "Couldn't load property data. Try again later." }, { status: 502 });
  }
}
