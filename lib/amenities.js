import { ensureTables, sql } from "./db";
import { addressKey, cleanAmenities } from "../app/results/amenities";

// Amenities the AI found on the web for an address, shared by everyone for 7
// days (the same as the listing data), so later analyses don't search again.
// A home that was searched without finding anything is saved too, so it isn't
// searched again for a week.
const DAYS = 7;
// Rentals and homes for sale are saved apart (a home for sale only has its
// "still for sale" answer).
const prefixFor = (mode) => (mode === "buy" ? "amenbuy|" : "amen|");
const keyFor = (address, mode) => `${prefixFor(mode)}${addressKey(address)}`;

// addresses -> Map(addressKey -> { features, sources, checkedAt })
export async function getSavedAmenities(addresses, mode = "rent") {
  const out = new Map();
  const prefix = prefixFor(mode);
  const keys = [...new Set(addresses.filter(Boolean).map((a) => keyFor(a, mode)))];
  if (!sql || !keys.length) return out;
  await ensureTables();
  const rows = await sql`
    SELECT key, data, fetched_at FROM area_cache
    WHERE key = ANY(${keys}) AND fetched_at > now() - make_interval(days => ${DAYS})`;
  for (const r of rows) {
    const a = cleanAmenities(r.data);
    if (a) out.set(r.key.slice(prefix.length), { ...a, checkedAt: r.fetched_at });
  }
  return out;
}

// What the AI found on the web for the user's own priorities ("dishwasher",
// "garage"), saved per address and priority for 7 days the same way, so a
// re-analysis with the same priority doesn't search those homes again.
// Priorities match ignoring case and extra spaces.
export const priorityKey = (p) =>
  String(p).replace(/[|\s]+/g, " ").trim().toLowerCase().slice(0, 100);
const customKeyFor = (address, priority) => `cust|${addressKey(address)}|${priorityKey(priority)}`;
const STATUSES = ["yes", "no", "unknown"];

// (addresses, priorities) -> Map(addressKey -> Map(priorityKey -> { status, detail, sources }))
export async function getSavedCustom(addresses, priorities) {
  const out = new Map();
  const keys = [];
  for (const a of new Set(addresses.filter(Boolean))) for (const p of priorities) keys.push(customKeyFor(a, p));
  if (!sql || !keys.length) return out;
  await ensureTables();
  const rows = await sql`
    SELECT key, data FROM area_cache
    WHERE key = ANY(${keys}) AND fetched_at > now() - make_interval(days => ${DAYS})`;
  for (const r of rows) {
    const rest = r.key.slice("cust|".length);
    const cut = rest.lastIndexOf("|");
    const [addr, prio] = [rest.slice(0, cut), rest.slice(cut + 1)];
    const d = r.data || {};
    if (!STATUSES.includes(d.status)) continue;
    if (!out.has(addr)) out.set(addr, new Map());
    out.get(addr).set(prio, {
      status: d.status,
      detail: String(d.detail || "").slice(0, 200),
      sources: cleanAmenities({ sources: d.sources })?.sources || [],
    });
  }
  return out;
}

// [{ address, priority, status, detail, sources }] -> saved (replacing anything older).
export async function saveCustom(entries) {
  if (!sql) return;
  for (const { address, priority, status, detail, sources } of entries) {
    if (!address || !priority || !STATUSES.includes(status)) continue;
    const data = { status, detail: String(detail || "").slice(0, 200), sources: (sources || []).slice(0, 4) };
    await sql`
      INSERT INTO area_cache (key, data, fetched_at) VALUES (${customKeyFor(address, priority)}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
  }
}

// [{ address, amenities }] -> saved (replacing anything older).
export async function saveAmenities(entries, mode = "rent") {
  if (!sql) return;
  for (const { address, amenities } of entries) {
    const a = cleanAmenities(amenities);
    if (!address || !a) continue;
    await sql`
      INSERT INTO area_cache (key, data, fetched_at) VALUES (${keyFor(address, mode)}, ${JSON.stringify(a)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
  }
}
