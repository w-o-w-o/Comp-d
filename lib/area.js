import { ensureTables, sql } from "./db";
import { distanceMiles } from "../app/results/geo";

// Public data about the area around a property:
//   Census geocoder  - which county and census tract a point is in (no key)
//   HUD              - Fair Market Rents by bedroom count (HUD_API_TOKEN)
//   Census ACS       - neighborhood median rent and home value (CENSUS_API_KEY)
//   Zillow Research  - rent and home value trends by ZIP (imported into Neon)
//   FEMA NFHL        - flood zone at a point (no key)
//   NCES            - nearest public schools, 2024-25 (no key)
//   EPA              - National Walkability Index for the block group (no key)
//   FBI Crime Data   - reported crime rates for the local police agency
//                      (FBI_API_KEY from api.data.gov; DEMO_KEY works at low volume)
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

// ---- Census: which city or township a point is in (for the crime lookup) ----
function placeAt(lat, lng) {
  return cached(`place|${round(lat)},${round(lng)}`, 365, async () => {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?" +
      new URLSearchParams({
        x: String(lng),
        y: String(lat),
        benchmark: "Public_AR_Current",
        vintage: "Current_Current",
        layers: "Incorporated Places,County Subdivisions",
        format: "json",
      });
    const g = (await getJson(url)).result?.geographies || {};
    const place = g["Incorporated Places"]?.[0];
    const sub = g["County Subdivisions"]?.[0];
    // Census county divisions (CCDs) are statistical areas with no government of
    // their own, so a point in one is unincorporated.
    const township = sub && !/\b(CCD|UT|unorganized)\b/i.test(sub.NAME) ? sub.BASENAME : null;
    return { city: place?.BASENAME || null, township };
  });
}

// ---- NCES: nearest public schools (no ratings; federal data has none) ----
const NCES_SCHOOLS_URL =
  "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1/query";
const NCES_DISTRICTS_URL =
  "https://nces.ed.gov/opengis/rest/services/School_District_Boundaries/EDGE_SCHOOLDISTRICT_TL25_SY2425/MapServer/1/query";
const SCHOOL_LEVELS = ["Elementary", "Middle", "High"];
export const SCHOOL_SEARCH_MILES = 5;

// Miles from a listing to the nearest school found around the subject, at
// each level and overall. null when the nearest could lie outside the area
// that was searched (the listing is near its edge).
export function schoolDistances(point, subject, schools) {
  if (!schools?.all) return null;
  const margin = SCHOOL_SEARCH_MILES - distanceMiles(subject, point);
  const nearest = (level) => {
    let best = Infinity;
    for (const s of schools.all) {
      if (level && s.level !== level) continue;
      best = Math.min(best, distanceMiles(point, s));
    }
    return best <= margin ? Math.round(best * 10) / 10 : null;
  };
  return {
    any: nearest(null),
    elementary: nearest("Elementary"),
    middle: nearest("Middle"),
    high: nearest("High"),
  };
}

// The public school district(s) a point is in. Some areas have separate
// elementary and high school districts, so this can be more than one.
async function schoolDistricts(lat, lng) {
  const url =
    `${NCES_DISTRICTS_URL}?` +
    new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "GEOID,NAME,LOGRADE,HIGRADE",
      returnGeometry: "false",
      f: "json",
    });
  const data = await getJson(url);
  if (data.error) throw new Error(data.error.message);
  return (data.features || []).map((f) => ({ id: f.attributes.GEOID, name: f.attributes.NAME }));
}

export function nearbySchools(lat, lng) {
  return cached(`schools3|${round(lat, 3)},${round(lng, 3)}`, 180, async () => {
    // A failed district lookup just means schools aren't matched to a district.
    const districts = (await safely("NCES districts", () => schoolDistricts(lat, lng))) || [];
    const districtIds = new Set(districts.map((d) => d.id));
    const url =
      `${NCES_SCHOOLS_URL}?` +
      new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        distance: String(SCHOOL_SEARCH_MILES),
        units: "esriSRUnit_StatuteMile",
        spatialRel: "esriSpatialRelIntersects",
        outFields:
          "SCH_NAME,LEAID,LEA_NAME,SCHOOL_LEVEL,GSLO,GSHI,MEMBER,STUTERATIO,CHARTER_TEXT,VIRTUAL,SY_STATUS_TEXT,LATCOD,LONCOD",
        returnGeometry: "false",
        f: "json",
      });
    const data = await getJson(url);
    if (data.error) throw new Error(data.error.message);
    const here = { lat, lng };
    const schools = (data.features || [])
      .map((f) => f.attributes)
      .filter((a) => a.SY_STATUS_TEXT === "Open" && !/^full/i.test(a.VIRTUAL || "") && a.LATCOD && a.LONCOD)
      .map((a) => ({
        name: a.SCH_NAME,
        district: a.LEA_NAME,
        inDistrict: districtIds.has(a.LEAID),
        level: a.SCHOOL_LEVEL,
        grades: a.GSLO && a.GSHI ? `${a.GSLO}–${a.GSHI}` : null, // formatted on the page
        students: a.MEMBER > 0 ? a.MEMBER : null,
        studentsPerTeacher: a.STUTERATIO > 0 ? Math.round(a.STUTERATIO * 10) / 10 : null,
        charter: a.CHARTER_TEXT === "Yes",
        lat: a.LATCOD,
        lng: a.LONCOD,
        miles: Math.round(distanceMiles(here, { lat: a.LATCOD, lng: a.LONCOD }) * 10) / 10,
      }))
      .sort((a, b) => a.miles - b.miles);
    // At each level: the nearest regular school in this address's district,
    // else the nearest regular school, else the nearest charter.
    const nearest = SCHOOL_LEVELS.map((level) => {
      const atLevel = schools.filter((s) => s.level === level);
      return (
        atLevel.find((s) => s.inDistrict && !s.charter) ||
        atLevel.find((s) => !s.charter) ||
        atLevel[0]
      );
    }).filter(Boolean);
    return {
      year: "2024–25",
      districts: districts.map((d) => d.name),
      nearest,
      withinOneMile: schools.filter((s) => s.miles <= 1).length,
      // Every school found (within SCHOOL_SEARCH_MILES), for per-listing distances.
      all: schools.map((s) => ({ level: s.level, lat: s.lat, lng: s.lng })),
    };
  });
}

// ---- EPA National Walkability Index (census block group, 1–20) ----
const EPA_WALK_URL = "https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query";

export function walkability(lat, lng) {
  return cached(`walk|${round(lat)},${round(lng)}`, 365, async () => {
    const url =
      `${EPA_WALK_URL}?` +
      new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "NatWalkInd",
        returnGeometry: "false",
        f: "json",
      });
    const data = await getJson(url);
    if (data.error) throw new Error(data.error.message);
    const score = data.features?.[0]?.attributes?.NatWalkInd;
    if (typeof score !== "number") return null;
    // EPA's own four bands.
    const label =
      score > 15.25 ? "Most walkable" : score > 10.5 ? "Above average" : score > 5.75 ? "Below average" : "Least walkable";
    return { score: Math.round(score * 10) / 10, label };
  });
}

// Walkability for many points, a few at a time.
export async function walkabilities(points, concurrency = 6) {
  const out = new Array(points.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < points.length) {
      const i = next++;
      out[i] = await safely("EPA walkability", () => walkability(points[i].lat, points[i].lng));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, points.length) }, worker));
  return out;
}

// ---- FBI Crime Data Explorer: reported crime for the local police agency ----
const FBI_BASE = "https://api.usa.gov/crime/fbi/cde";
const STATE_ABBR = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
  "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
};

const fbiKey = () => process.env.FBI_API_KEY || "DEMO_KEY";
const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

function agenciesInState(abbr) {
  return cached(`fbi-agencies|${abbr}`, 180, async () => {
    const byCounty = await getJson(`${FBI_BASE}/agency/byStateAbbr/${abbr}?API_KEY=${fbiKey()}`, {}, 30000);
    return Object.values(byCounty)
      .flat()
      .map((a) => ({ ori: a.ori, name: a.agency_name, type: a.agency_type_name, counties: a.counties || "" }));
  });
}

// The city or township police department, or the county sheriff for an
// unincorporated spot.
async function localAgency(geo, lat, lng) {
  const abbr = STATE_ABBR[geo.state];
  if (!abbr) return null;
  const [agencies, place] = await Promise.all([agenciesInState(abbr), placeAt(lat, lng)]);
  const county = normalize(geo.countyName.replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, ""));
  const inCounty = agencies.filter((a) => normalize(a.counties).split(/ ?, ?/).includes(county) || normalize(a.counties) === county);
  const pool = inCounty.length ? inCounty : agencies;
  for (const name of [place?.city, place?.township].filter(Boolean)) {
    const n = normalize(name);
    const match = pool.find((a) => a.type === "City" && normalize(a.name).startsWith(`${n} `));
    if (match) return match;
  }
  if (!place?.city) return inCounty.find((a) => a.type === "County" && /sheriff/i.test(a.name)) || null;
  return null;
}

// Sum of the 12 monthly rates = crimes per 100,000 residents that year.
function yearlyRate(series) {
  const values = Object.values(series || {}).filter((v) => typeof v === "number");
  return values.length === 12 ? Math.round(values.reduce((s, v) => s + v, 0)) : null;
}

function agencyCrime(agency, stateName) {
  return cached(`fbi-crime|${agency.ori}`, 90, async () => {
    const thisYear = new Date().getFullYear();
    for (const year of [thisYear - 1, thisYear - 2]) {
      const out = { year, agency: agency.name };
      let complete = true;
      for (const [key, offense] of [
        ["violent", "violent-crime"],
        ["property", "property-crime"],
      ]) {
        let data;
        try {
          data = await getJson(
            `${FBI_BASE}/summarized/agency/${agency.ori}/${offense}?from=01-${year}&to=12-${year}&API_KEY=${fbiKey()}`,
            {},
            30000
          );
        } catch {
          complete = false;
          break;
        }
        const rates = data.offenses?.rates || {};
        const local = yearlyRate(rates[`${agency.name} Offenses`]);
        if (local == null) {
          complete = false;
          break;
        }
        out[key] = {
          local,
          state: yearlyRate(rates[`${stateName} Offenses`]),
          national: yearlyRate(rates["United States Offenses"]),
        };
      }
      if (complete) return out;
    }
    return null;
  });
}

export async function crimeRates(geo, lat, lng) {
  const agency = await localAgency(geo, lat, lng);
  if (!agency) return null;
  const stateName = STATE_NAMES[geo.state];
  return agencyCrime(agency, stateName);
}

const STATE_NAMES = {
  "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California", "08": "Colorado",
  "09": "Connecticut", "10": "Delaware", "11": "District of Columbia", "12": "Florida", "13": "Georgia",
  "15": "Hawaii", "16": "Idaho", "17": "Illinois", "18": "Indiana", "19": "Iowa", "20": "Kansas",
  "21": "Kentucky", "22": "Louisiana", "23": "Maine", "24": "Maryland", "25": "Massachusetts", "26": "Michigan",
  "27": "Minnesota", "28": "Mississippi", "29": "Missouri", "30": "Montana", "31": "Nebraska", "32": "Nevada",
  "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York", "37": "North Carolina",
  "38": "North Dakota", "39": "Ohio", "40": "Oklahoma", "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island",
  "45": "South Carolina", "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah", "50": "Vermont",
  "51": "Virginia", "53": "Washington", "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming",
};

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
  const [fmr, medians, trends, flood, schools, walk, crime] = await Promise.all([
    geo && process.env.HUD_API_TOKEN
      ? safely("HUD", () => fairMarketRents(geo.countyGeoid, zip))
      : null,
    geo && process.env.CENSUS_API_KEY ? safely("Census ACS", () => neighborhoodMedians(geo)) : null,
    safely("Zillow trends", () => marketTrends([zip, commonZip])),
    safely("FEMA", () => floodZone(lat, lng)),
    safely("NCES", () => nearbySchools(lat, lng)),
    safely("EPA walkability", () => walkability(lat, lng)),
    geo ? safely("FBI crime", () => crimeRates(geo, lat, lng)) : null,
  ]);

  return {
    county: geo?.countyName || null,
    zip,
    fairMarketRent: fmr,
    neighborhood: medians,
    trends,
    flood,
    schools,
    walkability: walk,
    crime,
  };
}
