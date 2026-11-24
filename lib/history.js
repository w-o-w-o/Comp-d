import { ensureTables, sql } from "./db";

// Most searches kept per user; older ones are dropped.
const MAX_SAVED = 50;
// RentCast data is cached for 7 days, after which the listings are looked up
// again and can change. A saved search lasts as long as its data.
export const HISTORY_DAYS = 7;

// One history entry per place and rent/buy choice: searching the same place
// again updates the entry instead of adding a duplicate.
function searchKeyFor({ lat, lng, mode }) {
  return `${mode}|${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export async function saveSearch(userId, s) {
  await ensureTables();
  await sql`
    INSERT INTO search_history (
      user_id, search_key, address, formatted_address, place_id, lat, lng,
      mode, radius_miles, estimate_amount, listing_count, data_fetched_at
    ) VALUES (
      ${userId}, ${searchKeyFor(s)}, ${s.address}, ${s.formattedAddress}, ${s.placeId},
      ${s.lat}, ${s.lng}, ${s.mode}, ${s.radiusMiles}, ${s.estimateAmount}, ${s.listingCount},
      ${s.dataFetchedAt}
    )
    ON CONFLICT (user_id, search_key) DO UPDATE SET
      address = EXCLUDED.address,
      formatted_address = EXCLUDED.formatted_address,
      place_id = COALESCE(EXCLUDED.place_id, search_history.place_id),
      radius_miles = EXCLUDED.radius_miles,
      estimate_amount = EXCLUDED.estimate_amount,
      listing_count = EXCLUDED.listing_count,
      data_fetched_at = COALESCE(EXCLUDED.data_fetched_at, search_history.data_fetched_at),
      last_viewed_at = now()`;

  await sql`
    DELETE FROM search_history
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM search_history WHERE user_id = ${userId}
        ORDER BY last_viewed_at DESC LIMIT ${MAX_SAVED}
      )`;
}

// The user's searches whose data is under HISTORY_DAYS old. Expired ones are
// removed: reopening them would look up new data anyway.
export async function listSearches(userId, limit = MAX_SAVED) {
  if (!sql) return [];
  await ensureTables();
  await sql`
    DELETE FROM search_history
    WHERE user_id = ${userId}
      AND COALESCE(data_fetched_at, created_at) <= now() - make_interval(days => ${HISTORY_DAYS})`;
  return sql`
    SELECT * FROM search_history WHERE user_id = ${userId}
    ORDER BY last_viewed_at DESC LIMIT ${limit}`;
}

export async function deleteSearch(userId, id) {
  await ensureTables();
  // user_id check: people can only remove their own entries.
  await sql`DELETE FROM search_history WHERE id = ${id} AND user_id = ${userId}`;
}

// Rows from Neon contain Date objects; pass plain values to the client list.
export function toListEntries(rows) {
  return rows.map((r) => {
    const dataDate = new Date(r.data_fetched_at || r.created_at);
    return {
      id: Number(r.id),
      address: r.address,
      formatted_address: r.formatted_address,
      mode: r.mode,
      radius_miles: r.radius_miles,
      estimate_amount: r.estimate_amount,
      listing_count: r.listing_count,
      last_viewed_at: new Date(r.last_viewed_at).toISOString(),
      expires_at: new Date(dataDate.getTime() + HISTORY_DAYS * 86_400_000).toISOString(),
      href: historyHref(r),
    };
  });
}

// Link that reopens a saved search straight on its results.
export function historyHref(entry) {
  const params = new URLSearchParams({
    address: entry.address,
    radius: String(entry.radius_miles),
    mode: entry.mode,
    from: "history",
  });
  if (entry.place_id) params.set("placeId", entry.place_id);
  return `/results?${params}`;
}
