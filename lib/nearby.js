import { ensureTables, sql } from "./db";

// Nearby-place counts (groceries, parks, restaurants/cafes, transit) are
// looked up in the browser with Google Places, since the Maps key only works
// from the site. Each lookup is 4 paid Google requests, so the result is saved
// here and reused the next time that user opens the same place.

// Places change slowly; a month-old count is still a fair picture.
export const NEARBY_CACHE_DAYS = 30;

const NEARBY_COUNTS = [
  "groceriesWithinHalfMile",
  "parksWithinHalfMile",
  "restaurantsAndCafesWithinHalfMile",
  "transitStopsWithinQuarterMile",
];

// Checks counts sent by the browser: whole numbers 0-20 (Google returns at
// most 20) and a nearest-grocery distance within the 2-mile search.
export function parseNearby(n) {
  if (!n || typeof n !== "object") return null;
  const out = {};
  for (const k of NEARBY_COUNTS) {
    if (!Number.isInteger(n[k]) || n[k] < 0 || n[k] > 20) return null;
    out[k] = n[k];
  }
  const g = n.nearestGroceryMiles;
  out.nearestGroceryMiles = Number.isFinite(g) && g >= 0 && g <= 5 ? Math.round(g * 100) / 100 : null;
  return out;
}

// Saved per user: the counts come from that user's browser, so one person
// can't change what everyone else sees.
const keyFor = (userId, lat, lng) => `nearby|${userId}|${lat.toFixed(4)},${lng.toFixed(4)}`;

export async function getSavedNearby(userId, lat, lng) {
  await ensureTables();
  const rows = await sql`
    SELECT data FROM area_cache
    WHERE key = ${keyFor(userId, lat, lng)}
      AND fetched_at > now() - make_interval(days => ${NEARBY_CACHE_DAYS})`;
  return rows.length ? parseNearby(rows[0].data) : null;
}

export async function saveNearby(userId, lat, lng, data) {
  await ensureTables();
  await sql`
    INSERT INTO area_cache (key, data) VALUES (${keyFor(userId, lat, lng)}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
}
