import { ensureTables, sql } from "./db";
import { HISTORY_DAYS } from "./history";

// Commute checks are computed in the browser (Google Routes, ~$0.21 each past
// the free tier), so each search gets at most COMMUTE_LIMIT of them. They're
// saved with the search, so picking one again costs nothing. Like the search
// history, they last as long as the search's 7-day listing data.
export const COMMUTE_LIMIT = 3;
const TRAVEL_MODES = ["DRIVING", "TRANSIT", "BICYCLING", "WALKING"];
const MAX_LISTINGS = 100;

// Same key as the search history: one place and rent/buy choice.
export function commuteSearchKey(lat, lng, mode) {
  return `${mode === "buy" ? "buy" : "rent"}|${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// Destinations that differ only in case or spacing count as the same.
export const sameDestination = (a, b) => normalize(a) === normalize(b);
function normalize(s) {
  return String(s).replace(/\s+/g, " ").trim().toLowerCase();
}

// Checks a commute result sent by the browser.
export function parseCheck(c) {
  if (!c || typeof c !== "object" || !TRAVEL_MODES.includes(c.travelMode)) return null;
  const destination = typeof c.destination === "string" ? c.destination.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!destination) return null;
  const minutes = (v) => (Number.isFinite(v) && v >= 0 && v < 1440 ? Math.round(v) : null);
  const miles = (v) => (Number.isFinite(v) && v >= 0 && v < 2000 ? Math.round(v * 10) / 10 : null);
  const map = (obj, fn) => {
    const out = {};
    for (const [id, v] of Object.entries(obj && typeof obj === "object" ? obj : {}).slice(0, MAX_LISTINGS)) {
      out[String(id).slice(0, 200)] = fn(v);
    }
    return out;
  };
  return {
    destination,
    travelMode: c.travelMode,
    subjectMinutes: minutes(c.subjectMinutes),
    subjectMiles: miles(c.subjectMiles),
    byListing: map(c.byListing, minutes),
    milesByListing: map(c.milesByListing, miles),
  };
}

// The search's saved checks, oldest first.
export async function listCommutes(userId, searchKey) {
  await ensureTables();
  const rows = await sql`
    SELECT data FROM commute_checks
    WHERE user_id = ${userId} AND search_key = ${searchKey}
      AND created_at > now() - make_interval(days => ${HISTORY_DAYS})
    ORDER BY created_at`;
  return rows.map((r) => r.data);
}

// Saves a check unless the search already has COMMUTE_LIMIT. Returns the
// updated list, or null when the limit is reached.
export async function saveCommute(userId, searchKey, check) {
  await ensureTables();
  // Expired checks no longer count toward the limit.
  await sql`
    DELETE FROM commute_checks
    WHERE user_id = ${userId} AND search_key = ${searchKey}
      AND created_at <= now() - make_interval(days => ${HISTORY_DAYS})`;
  const existing = await listCommutes(userId, searchKey);
  const dest = normalize(check.destination);
  const replacing = existing.some((c) => normalize(c.destination) === dest && c.travelMode === check.travelMode);
  if (!replacing && existing.length >= COMMUTE_LIMIT) return null;
  await sql`
    INSERT INTO commute_checks (user_id, search_key, destination, travel_mode, data)
    VALUES (${userId}, ${searchKey}, ${dest}, ${check.travelMode}, ${JSON.stringify(check)}::jsonb)
    ON CONFLICT (user_id, search_key, destination, travel_mode) DO UPDATE SET data = EXCLUDED.data`;
  return listCommutes(userId, searchKey);
}
