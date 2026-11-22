import { ensureTables, sql } from "./db";

// Public data about the area around a property:
//   Census geocoder  - which county and census tract a point is in (no key)
//   HUD              - Fair Market Rents by bedroom count (HUD_API_TOKEN)
//   Census ACS       - neighborhood median rent and home value (CENSUS_API_KEY)
//   Zillow Research  - rent and home value trends by ZIP (imported into Neon)
//   FEMA NFHL        - flood zone at a point (no key)
// (Nearby places come from Google Places in the browser: app/results/NearbyPlaces.js.)
// Every answer is cached in Neon; a failed source returns null instead of
// breaking the rest.

const TIMEOUT_MS = 12000;
// Tells public services who is calling (some reject anonymous requests).
const USER_AGENT = "Compd/0.1 (+https://comp-d.vercel.app; ENGR 310 class project)";

// Lookups in progress, so simultaneous requests for the same data share one
// call to the outside service instead of each making their own.
const inFlight = new Map();

function cached(key, days, load) {
  if (inFlight.has(key)) return inFlight.get(key);
  const work = (async () => {
    await ensureTables();
    const rows = await sql`
      SELECT data FROM area_cache
      WHERE key = ${key} AND fetched_at > now() - make_interval(days => ${days})`;
    if (rows.length) return rows[0].data;
    const data = await load();
    await sql`
      INSERT INTO area_cache (key, data) VALUES (${key}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
    return data;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

async function getJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, {
    ...options,
    headers: { "User-Agent": USER_AGENT, ...options.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

// Logs and returns null so one unavailable source doesn't break the others.
async function safely(label, work) {
  try {
    return await work();
  } catch (err) {
    console.error(`Area data (${label}) failed:`, err.message);
    return null;
  }
}

const round = (n, places = 4) => n.toFixed(places);

// ---- Census geocoder: county and tract for a point ----
export function censusGeography(lat, lng) {
  return cached(`geo|${round(lat)},${round(lng)}`, 365, async () => {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?" +
      new URLSearchParams({
        x: String(lng),
        y: String(lat),
        benchmark: "Public_AR_Current",
        vintage: "Current_Current",
        layers: "Census Tracts,Counties",
        format: "json",
      });
    const data = await getJson(url);
    const tract = data.result?.geographies?.["Census Tracts"]?.[0];
    const county = data.result?.geographies?.Counties?.[0];
    if (!tract || !county) return null;
    return {
      state: tract.STATE,
      county: tract.COUNTY,
      tract: tract.TRACT,
      countyGeoid: county.GEOID,
      countyName: county.NAME,
    };
  });
}

// ---- HUD Fair Market Rents ----
const FMR_KEYS = ["Efficiency", "One-Bedroom", "Two-Bedroom", "Three-Bedroom", "Four-Bedroom"];

export function fairMarketRents(countyGeoid, zip) {
  return cached(`hud|${countyGeoid}|${zip || ""}`, 90, async () => {
    const data = await getJson(`https://www.huduser.gov/hudapi/public/fmr/data/${countyGeoid}99999`, {
      headers: { Authorization: `Bearer ${process.env.HUD_API_TOKEN}` },
    });
    const d = data.data;
    // Metro areas with Small Area FMRs return one row per ZIP code.
    let row = d.basicdata;
    let smallArea = false;
    if (Array.isArray(row)) {
      smallArea = true;
      row = row.find((r) => r.zip_code === zip) || row.find((r) => /msa/i.test(r.zip_code)) || row[0];
    }
    if (!row) return null;
    return {
      area: d.area_name || d.county_name,
      year: row.year ?? null,
      smallArea: smallArea && row.zip_code === zip,
      byBedrooms: FMR_KEYS.map((k) => row[k] ?? null), // index = bedroom count
    };
  });
}

// ---- Census ACS 5-year: tract medians (no demographic breakdowns) ----
export function neighborhoodMedians(geo) {
  return cached(`acs|${geo.state}${geo.county}${geo.tract}`, 90, async () => {
    for (const year of [2024, 2023]) {
      const url =
        `https://api.census.gov/data/${year}/acs/acs5?` +
        new URLSearchParams({
          get: "B25064_001E,B25077_001E",
          for: `tract:${geo.tract}`,
          in: `state:${geo.state} county:${geo.county}`,
          key: process.env.CENSUS_API_KEY,
        });
      let rows;
      try {
        rows = await getJson(url);
      } catch {
        continue; // that year isn't published yet
      }
      // Negative values are Census placeholders for "not available".
      const value = (v) => (Number(v) > 0 ? Number(v) : null);
      return { year, medianRent: value(rows[1]?.[0]), medianHomeValue: value(rows[1]?.[1]) };
    }
    return null;
  });
}

// ---- Zillow trends (imported table) ----
export async function marketTrends(zips) {
  await ensureTables();
  for (const zip of zips.filter(Boolean)) {
    const [row] = await sql`SELECT * FROM market_trends WHERE zip = ${zip}`;
    if (row && (row.zori || row.zhvi)) {
      return {
        zip,
        typicalRent: row.zori,
        rentChangeYoY: row.zori_yoy,
        typicalHomeValue: row.zhvi,
        homeValueChangeYoY: row.zhvi_yoy,
        asOf: row.zori_as_of || row.zhvi_as_of,
      };
    }
  }
  return null;
}

// ---- FEMA flood zone ----
const FEMA_ZONES_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

export function floodZone(lat, lng) {
  return cached(`flood|${round(lat)},${round(lng)}`, 180, async () => {
    const url =
      `${FEMA_ZONES_URL}?` +
      new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
        returnGeometry: "false",
        f: "json",
      });
    const data = await getJson(url);
    if (data.error) throw new Error(data.error.message);
    const a = data.features?.[0]?.attributes;
    if (!a) return { zone: null, risk: "unmapped", label: "No FEMA flood map for this spot" };
    const subtype = a.ZONE_SUBTY || "";
    let risk = "minimal";
    if (a.SFHA_TF === "T") risk = "high";
    else if (/0\.2 PCT|LEVEE/i.test(subtype)) risk = "moderate";
    else if (a.FLD_ZONE === "D") risk = "undetermined";
    const labels = {
      high: `Zone ${a.FLD_ZONE}: high flood risk (flood insurance usually required with a mortgage)`,
      moderate: `Zone ${a.FLD_ZONE}: moderate flood risk`,
      minimal: `Zone ${a.FLD_ZONE}: minimal flood risk`,
      undetermined: "Zone D: flood risk not determined",
    };
    return { zone: a.FLD_ZONE, risk, label: labels[risk] };
  });
}

// Flood zones for many points, a few at a time to be gentle on FEMA's server.
export async function floodZones(points, concurrency = 6) {
  const out = new Array(points.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < points.length) {
      const i = next++;
      out[i] = await safely("FEMA", () => floodZone(points[i].lat, points[i].lng));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, points.length) }, worker));
  return out;
}

// ---- Everything about the subject's area, for the panel and the AI ----
export function zipFromAddress(address = "") {
  return address.match(/\b(\d{5})(?:-\d{4})?(?:,\s*USA)?\s*$/)?.[1] || null;
}

// Nearby places aren't here: they come from Google Places in the browser.
export async function areaProfile({ lat, lng, address, listingZips = [] }) {
  const zip = zipFromAddress(address);
  // Most common ZIP among nearby listings: a fallback when the subject's own
  // ZIP has no data (e.g. a campus).
  const counts = {};
  for (const z of listingZips.filter(Boolean)) counts[z] = (counts[z] || 0) + 1;
  const commonZip = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const geo = await safely("Census geocoder", () => censusGeography(lat, lng));
  const [fmr, medians, trends, flood] = await Promise.all([
    geo && process.env.HUD_API_TOKEN
      ? safely("HUD", () => fairMarketRents(geo.countyGeoid, zip))
      : null,
    geo && process.env.CENSUS_API_KEY ? safely("Census ACS", () => neighborhoodMedians(geo)) : null,
    safely("Zillow trends", () => marketTrends([zip, commonZip])),
    safely("FEMA", () => floodZone(lat, lng)),
  ]);

  return {
    county: geo?.countyName || null,
    zip,
    fairMarketRent: fmr,
    neighborhood: medians,
    trends,
    flood,
  };
}
