import { BudgetError, rentcastGet } from "./rentcast";

// Loads the property's estimate and the active listings around it from
// RentCast (served from the Neon cache when possible), in Comp'd's own shape.
export async function loadComps({ lat, lng, fetchRadius, mode, address, userId }) {
  // Rounding (~100 m) lets nearby repeat searches share cached results.
  const latitude = lat.toFixed(3);
  const longitude = lng.toFixed(3);

  const listings = await rentcastGet(
    mode === "buy" ? "/listings/sale" : "/listings/rental/long-term",
    { latitude, longitude, radius: String(fetchRadius), status: "Active", limit: "500" },
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

  return {
    estimate: estimate && normalizeEstimate(estimate, mode),
    listings: (listings || []).map(normalizeListing).filter(Boolean),
  };
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
