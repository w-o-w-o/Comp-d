import { ensureTables, sql } from "./db";
import { loadListings } from "./comps";
import { typeGroup } from "../app/results/quality";
import { distanceMiles } from "../app/results/geo";

// The free "Try it" demo: one address, picked by us, that changes every week.
// Everyone sees the same listings (RentCast data is cached for 7 days and
// shared), the same ready-made AI analysis, and a preset commute. Each account
// also gets one custom AI analysis per week (lib/access.js).
//
// Coordinates are from the U.S. Census geocoder. `commuteTo` is the preset
// commute destination shown in the demo.
export const DEMO_PLACES = [
  { address: "1 Grand Ave, San Luis Obispo, CA 93407", lat: 35.298657, lng: -120.655669, commuteTo: "Mission San Luis Obispo de Tolosa, San Luis Obispo, CA" },
  { address: "415 S Atherton St, State College, PA 16801", lat: 40.788697, lng: -77.860886, commuteTo: "Beaver Stadium, State College, PA" },
  { address: "1100 Congress Ave, Austin, TX 78701", lat: 30.276442, lng: -97.739754, commuteTo: "University of Texas at Austin, Austin, TX" },
  { address: "200 E Colfax Ave, Denver, CO 80203", lat: 39.739997, lng: -104.984403, commuteTo: "Denver International Airport, Denver, CO" },
  { address: "1 W Edenton St, Raleigh, NC 27601", lat: 35.781154, lng: -78.639108, commuteTo: "North Carolina State University, Raleigh, NC" },
  { address: "2 E Main St, Madison, WI 53703", lat: 43.073996, lng: -89.383109, commuteTo: "University of Wisconsin-Madison, Madison, WI" },
  { address: "700 W Jefferson St, Boise, ID 83702", lat: 43.61736, lng: -116.200031, commuteTo: "Boise Airport, Boise, ID" },
  { address: "600 Dexter Ave, Montgomery, AL 36104", lat: 32.377614, lng: -86.301883, commuteTo: "Alabama State University, Montgomery, AL" },
  { address: "1 Ashburton Pl, Boston, MA 02108", lat: 42.35926, lng: -71.062783, commuteTo: "Boston Logan International Airport, Boston, MA" },
  { address: "1700 W Washington St, Phoenix, AZ 85007", lat: 33.448175, lng: -112.098251, commuteTo: "Phoenix Sky Harbor International Airport, Phoenix, AZ" },
  { address: "1100 Main St, Kansas City, MO 64105", lat: 39.100752, lng: -94.583242, commuteTo: "Kansas City International Airport, Kansas City, MO" },
];

const WEEK_MS = 7 * 86_400_000;
// Weeks start Monday 00:00 UTC (1970-01-05 was a Monday).
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);

function weekNumber(now) {
  return Math.floor((now - EPOCH_MONDAY) / WEEK_MS);
}

// Repeatable random numbers from a seed (mulberry32).
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The places in a random order for one cycle (one week each).
function cycleOrder(cycle) {
  const random = seededRandom(cycle * 2654435761);
  const order = DEMO_PLACES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Every place once per cycle, in a new random order each cycle, and never
// the same place two weeks in a row (across cycles too).
function indexForWeek(week) {
  const n = DEMO_PLACES.length;
  const cycle = Math.floor(week / n);
  const order = cycleOrder(cycle);
  const lastOfPrevious = cycleOrder(cycle - 1)[n - 1];
  if (order[0] === lastOfPrevious) [order[0], order[1]] = [order[1], order[0]];
  return order[week - cycle * n];
}

// This week's demo: { week, address, lat, lng, commuteTo, endsAt }.
export function currentDemo(now = Date.now()) {
  const week = weekNumber(now);
  const place = DEMO_PLACES[indexForWeek(week)];
  return {
    ...place,
    week: `w${week}`,
    endsAt: new Date(EPOCH_MONDAY + (week + 1) * WEEK_MS).toISOString(),
  };
}

const near = (lat, lng, p) => Math.abs(lat - p.lat) < 0.0005 && Math.abs(lng - p.lng) < 0.0005;
const DEMO_FETCH_MILES = 5;
const subjectKey = (week, mode) => `demo|${week}|${mode === "buy" ? "buy" : "rent"}`;

// The home the demo judges this week: a real listing near the city point
// (the nearest ordinary 1-3 bedroom house or apartment with a known size), so
// the comparison is like a real search. Picked once per week and mode, then
// saved, so it stays the same all week. Returns this week's demo with
// { address, lat, lng } of that home and the city `center`.
export async function demoSubject(mode, now = Date.now()) {
  const d = currentDemo(now);
  const center = { lat: d.lat, lng: d.lng };
  const key = subjectKey(d.week, mode);
  await ensureTables();
  const [saved] = await sql`SELECT data FROM area_cache WHERE key = ${key}`;
  if (saved) return { ...d, ...saved.data, center };

  const { listings } = await loadListings({ ...center, fetchRadius: DEMO_FETCH_MILES, mode, userId: "demo" });
  const pick = listings
    .filter(
      (l) =>
        l.beds >= 1 && l.beds <= 3 && l.sqft > 0 && !l.possiblyPerRoom &&
        ["house", "apartment"].includes(typeGroup(l.type))
    )
    .map((l) => ({ l, miles: distanceMiles(center, l) }))
    .filter((x) => x.miles <= 1.5)
    .sort((a, b) => a.miles - b.miles)[0]?.l;
  // No suitable listing: fall back to the city point itself.
  const subject = pick
    ? { address: pick.address, lat: pick.lat, lng: pick.lng }
    : { address: d.address, lat: d.lat, lng: d.lng };
  await sql`
    INSERT INTO area_cache (key, data) VALUES (${key}, ${JSON.stringify(subject)}::jsonb)
    ON CONFLICT (key) DO NOTHING`;
  const [stored] = await sql`SELECT data FROM area_cache WHERE key = ${key}`;
  return { ...d, ...(stored?.data || subject), center };
}

// This week's demo if a point is its city point or one of its chosen homes
// (as { ...demo, center }), otherwise null. Never looks anything up.
export async function demoAt(lat, lng, now = Date.now()) {
  const d = currentDemo(now);
  const center = { lat: d.lat, lng: d.lng };
  if (near(lat, lng, d)) return { ...d, center };
  if (!sql) return null;
  await ensureTables();
  const rows = await sql`
    SELECT data FROM area_cache WHERE key IN (${subjectKey(d.week, "rent")}, ${subjectKey(d.week, "buy")})`;
  const hit = rows.find((r) => near(lat, lng, r.data));
  return hit ? { ...d, ...hit.data, center } : null;
}
