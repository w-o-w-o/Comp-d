import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError, rentcastGet } from "../../../lib/rentcast";

// Listings are fetched for a fixed area and filtered by the user's exact radius
// in the browser, so small radius changes don't cost new requests.
const FETCH_RADII_MILES = [5, 10, 25];

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

  // Rounding (~100 m) lets nearby repeat searches share cached results.
  const latitude = lat.toFixed(3);
  const longitude = lng.toFixed(3);

  try {
    const listings = await rentcastGet(
      mode === "buy" ? "/listings/sale" : "/listings/rental/long-term",
      { latitude, longitude, radius: String(radius), status: "Active", limit: "500" },
      userId
    );

    // The estimate is optional: some addresses (e.g. a whole campus) have none.
    let estimate = null;
    try {
      estimate = await rentcastGet(
        mode === "buy" ? "/avm/value" : "/avm/rent/long-term",
        address ? { address } : { latitude, longitude },
        userId
      );
    } catch (err) {
      if (err instanceof BudgetError) throw err;
      console.error("RentCast estimate failed:", err);
    }

    return Response.json({
      mode,
      fetchRadius: radius,
      estimate: estimate && normalizeEstimate(estimate, mode),
      listings: (listings || []).map(normalizeListing).filter(Boolean),
    });
  } catch (err) {
    if (err instanceof BudgetError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    console.error("Comps lookup failed:", err);
    return Response.json({ error: "Couldn't load property data. Try again later." }, { status: 502 });
  }
}

function normalizeListing(l) {
  if (typeof l.latitude !== "number" || typeof l.longitude !== "number" || !l.price) return null;
  return {
    id: l.id,
    address: l.formattedAddress,
    lat: l.latitude,
    lng: l.longitude,
    price: l.price,
    beds: l.bedrooms ?? null,
    baths: l.bathrooms ?? null,
    sqft: l.squareFootage ?? null,
    type: l.propertyType ?? null,
    yearBuilt: l.yearBuilt ?? null,
    daysOnMarket: l.daysOnMarket ?? null,
  };
}

function normalizeEstimate(e, mode) {
  const s = e.subjectProperty || {};
  return {
    amount: mode === "buy" ? e.price : e.rent,
    low: mode === "buy" ? e.priceRangeLow : e.rentRangeLow,
    high: mode === "buy" ? e.priceRangeHigh : e.rentRangeHigh,
    subject: {
      beds: s.bedrooms ?? null,
      baths: s.bathrooms ?? null,
      sqft: s.squareFootage ?? null,
      type: s.propertyType ?? null,
      yearBuilt: s.yearBuilt ?? null,
      lastSalePrice: s.lastSalePrice ?? null,
      lastSaleDate: s.lastSaleDate ?? null,
    },
  };
}
