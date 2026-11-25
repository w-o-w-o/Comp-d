import { ensureTables, sql } from "./db";
import { addressKey, cleanAmenities } from "../app/results/amenities";

// Amenities the AI found on the web for an address, shared by everyone for 7
// days (the same as the listing data), so later analyses don't search again.
// A home that was searched without finding anything is saved too, so it isn't
// searched again for a week.
const DAYS = 7;
const keyFor = (address) => `amen|${addressKey(address)}`;

// addresses -> Map(addressKey -> { features, sources, checkedAt })
export async function getSavedAmenities(addresses) {
  const out = new Map();
  const keys = [...new Set(addresses.filter(Boolean).map(keyFor))];
  if (!sql || !keys.length) return out;
  await ensureTables();
  const rows = await sql`
    SELECT key, data, fetched_at FROM area_cache
    WHERE key = ANY(${keys}) AND fetched_at > now() - make_interval(days => ${DAYS})`;
  for (const r of rows) {
    const a = cleanAmenities(r.data);
    if (a) out.set(r.key.slice("amen|".length), { ...a, checkedAt: r.fetched_at });
  }
  return out;
}

// [{ address, amenities }] -> saved (replacing anything older).
export async function saveAmenities(entries) {
  if (!sql) return;
  for (const { address, amenities } of entries) {
    const a = cleanAmenities(amenities);
    if (!address || !a) continue;
    await sql`
      INSERT INTO area_cache (key, data, fetched_at) VALUES (${keyFor(address)}, ${JSON.stringify(a)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
  }
}
