// Listing checks and "similar homes" filters, shared by the results page and
// the AI route so both see the same homes.

const DAY_MS = 86_400_000;
// A higher price this recently before the current listing counts as a price cut.
const PRICE_CUT_WINDOW_DAYS = 120;

export const TYPE_GROUPS = {
  house: { label: "Houses", types: ["Single Family", "Townhouse", "Multi-Family", "Manufactured"] },
  apartment: { label: "Apartments & condos", types: ["Apartment", "Condo"] },
  land: { label: "Land", types: ["Land"] },
};

export function typeGroup(type) {
  for (const [group, { types }] of Object.entries(TYPE_GROUPS)) {
    if (types.includes(type)) return group;
  }
  return null;
}

// Bedroom choices; 4 means "4 or more".
export const BED_OPTIONS = [0, 1, 2, 3, 4];
export const bedBucket = (beds) => (beds == null ? null : Math.min(Math.floor(beds), 4));

// Default filters for a subject home: its bedroom count ±1 and its kind of
// home when RentCast knows them; otherwise everything except land.
export function defaultFilters(subject) {
  const b = bedBucket(subject?.beds);
  const group = typeGroup(subject?.type);
  return {
    beds: b == null ? [] : BED_OPTIONS.filter((x) => Math.abs(x - b) <= 1),
    types: group ? [group] : ["house", "apartment"],
  };
}

// Empty lists mean "any". Listings without a bedroom count only pass "any".
export function matchesFilters(listing, filters) {
  if (!filters) return true;
  if (filters.beds?.length && !filters.beds.includes(bedBucket(listing.beds))) return false;
  if (filters.types?.length) {
    const group = typeGroup(listing.type);
    if (group && !filters.types.includes(group)) return false;
  }
  return true;
}

// Checks a filters object sent by the browser.
export function parseFilters(f) {
  if (!f || typeof f !== "object") return null;
  const beds = Array.isArray(f.beds) ? f.beds.filter((b) => BED_OPTIONS.includes(b)) : [];
  const types = Array.isArray(f.types) ? f.types.filter((t) => t in TYPE_GROUPS) : [];
  return { beds: [...new Set(beds)], types: [...new Set(types)] };
}

// Facts from RentCast's raw listing record: how long it has really been listed
// (counted from today, not from when the data was cached), its last earlier
// listing, and HOA fee.
export function listingHistory(raw, now = Date.now()) {
  const listed = raw.listedDate ? Date.parse(raw.listedDate) : NaN;
  const daysListed = Number.isFinite(listed)
    ? Math.max(0, Math.floor((now - listed) / DAY_MS))
    : raw.daysOnMarket ?? null;

  // History has one entry per time the home was listed, keyed by date.
  const earlier = Object.entries(raw.history || {})
    .map(([date, e]) => ({ date: Date.parse(e.listedDate || date), price: e.price }))
    .filter((e) => Number.isFinite(e.date) && e.price && (!Number.isFinite(listed) || e.date < listed))
    .sort((a, b) => b.date - a.date)[0];

  const priceCut =
    earlier && earlier.price > raw.price && Number.isFinite(listed) &&
    (listed - earlier.date) / DAY_MS <= PRICE_CUT_WINDOW_DAYS
      ? earlier.price - raw.price
      : null;

  return {
    daysListed,
    previousPrice: earlier?.price ?? null,
    previousListedDate: earlier ? new Date(earlier.date).toISOString().slice(0, 10) : null,
    priceCut,
    hoaFee: raw.hoa?.fee || null,
  };
}

// Price per square foot, rounded to the dollar (null without a size, or for land).
export function pricePerSqft(l) {
  return l.sqft > 0 && l.price && typeGroup(l.type) !== "land" ? Math.round(l.price / l.sqft) : null;
}

// Median price per square foot of a set of homes; needs at least 3 with a size.
export function medianPricePerSqft(listings) {
  const values = listings.map(pricePerSqft).filter(Boolean).sort((a, b) => a - b);
  if (values.length < 3) return null;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
  return { median, count: values.length };
}

// Flags rentals with 3+ bedrooms priced below what a typical studio or
// 1-bedroom nearby rents for: usually a per-room price, not the whole home.
export function flagPerRoomPrices(listings, mode) {
  if (mode !== "rent") return listings;
  const small = listings
    .filter((l) => l.beds != null && l.beds <= 1)
    .map((l) => l.price)
    .sort((a, b) => a - b);
  if (small.length < 3) return listings;
  const typicalSmall = small[Math.floor(small.length / 2)];
  return listings.map((l) =>
    l.beds >= 3 && l.price < typicalSmall ? { ...l, possiblyPerRoom: true } : l
  );
}
