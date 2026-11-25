import { BudgetError, rentcastGet, rentcastGetDated } from "./rentcast";
import { flagPerRoomPrices, listingHistory } from "../app/results/quality";

// Loads the property's estimate and the active listings around it from
// RentCast (served from the Neon cache when possible), in Comp'd's own shape.
// `listingsFetchedAt` says how fresh the listings are.
// `listingsCenter` fetches the listings around another point (the weekly
// demo fetches around its city point and judges one home near it), and
// `excludeAddress` leaves that home out of its own comparison.
// `addressesPerDay` is the user's plan's daily safety limit on new addresses.
export async function loadComps({
  lat,
  lng,
  fetchRadius,
  mode,
  address,
  userId,
  addressesPerDay = null,
  listingsCenter = null,
  excludeAddress = null,
}) {
  const center = listingsCenter || { lat, lng };
  const { listings, listingsFetchedAt } = await loadListings({ ...center, fetchRadius, mode, userId, addressesPerDay });

  // The estimate is optional: some addresses (e.g. a whole campus) have none.
  let estimate = null;
  try {
    estimate = await rentcastGet(
      mode === "buy" ? "/avm/value" : "/avm/rent/long-term",
      address ? { address } : { latitude: lat.toFixed(3), longitude: lng.toFixed(3) },
      userId,
      addressesPerDay
    );
  } catch (err) {
    if (err instanceof BudgetError) throw err;
    console.error("RentCast estimate failed:", err);
  }

  return {
    estimate: estimate && normalizeEstimate(estimate, mode),
    listings: excludeAddress ? listings.filter((l) => l.address !== excludeAddress) : listings,
    listingsFetchedAt,
  };
}

// The active listings around a point, in Comp'd's shape.
export async function loadListings({ lat, lng, fetchRadius, mode, userId, addressesPerDay = null }) {
  // Rounding (~100 m) lets nearby repeat searches share cached results.
  const { data, fetchedAt } = await rentcastGetDated(
    mode === "buy" ? "/listings/sale" : "/listings/rental/long-term",
    { latitude: lat.toFixed(3), longitude: lng.toFixed(3), radius: String(fetchRadius), status: "Active", limit: "500" },
    userId,
    addressesPerDay
  );
  return {
    listings: flagPerRoomPrices((data || []).map(normalizeListing).filter(Boolean), mode),
    listingsFetchedAt: fetchedAt,
  };
}

function normalizeListing(l) {
  if (typeof l.latitude !== "number" || typeof l.longitude !== "number" || !l.price) return null;
  return {
    id: l.id,
    address: l.formattedAddress,
    zip: l.zipCode ?? null,
    lat: l.latitude,
    lng: l.longitude,
    price: l.price,
    beds: l.bedrooms ?? null,
    baths: l.bathrooms ?? null,
    sqft: l.squareFootage ?? null,
    lotSize: l.lotSize ?? null,
    type: l.propertyType ?? null,
    yearBuilt: l.yearBuilt ?? null,
    // Listed on an MLS: MLS listings are fed to Zillow, so it has a page.
    onMls: Boolean(l.mlsNumber),
    // daysListed, previousPrice, previousListedDate, priceCut, hoaFee
    ...listingHistory(l),
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
