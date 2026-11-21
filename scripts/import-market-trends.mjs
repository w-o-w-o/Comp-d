// Imports Zillow Research's monthly rent (ZORI) and home value (ZHVI) indexes
// by ZIP code into Neon, keeping only the latest value and its change over the
// past year. Zillow updates these monthly; re-run this script to refresh.
//
//   node --env-file=.env.local scripts/import-market-trends.mjs
//
// Data: Zillow Research (https://www.zillow.com/research/data/), used with attribution.

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");

const SOURCES = {
  zori: "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
  zhvi: "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
};

// Splits one CSV line, respecting quoted fields that contain commas.
function parseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

// Streams one Zillow CSV and returns Map(zip -> { value, yoy, asOf }).
async function readIndex(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const lines = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });

  const byZip = new Map();
  let header = null;
  let zipCol, lastCol, yearAgoCol;
  for await (const line of lines) {
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols;
      zipCol = header.indexOf("RegionName");
      lastCol = header.length - 1; // date columns are oldest -> newest
      yearAgoCol = lastCol - 12;
      continue;
    }
    // Use the newest month that has a value, and the same month a year before.
    let col = lastCol;
    while (col > yearAgoCol && !cols[col]) col--;
    const value = Number(cols[col]);
    if (!cols[col] || !Number.isFinite(value)) continue;
    const prior = Number(cols[col - 12]);
    byZip.set(cols[zipCol].padStart(5, "0"), {
      value: Math.round(value),
      yoy: cols[col - 12] && prior > 0 ? Math.round(((value - prior) / prior) * 1000) / 10 : null,
      asOf: header[col],
    });
  }
  return byZip;
}

const sql = neon(process.env.DATABASE_URL);
await sql`
  CREATE TABLE IF NOT EXISTS market_trends (
    zip text PRIMARY KEY,
    zori double precision,
    zori_yoy double precision,
    zori_as_of date,
    zhvi double precision,
    zhvi_yoy double precision,
    zhvi_as_of date,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;

console.log("Downloading Zillow rent index (ZORI)...");
const zori = await readIndex(SOURCES.zori);
console.log(`  ${zori.size} ZIP codes`);
console.log("Downloading Zillow home value index (ZHVI, ~120 MB)...");
const zhvi = await readIndex(SOURCES.zhvi);
console.log(`  ${zhvi.size} ZIP codes`);

const zips = [...new Set([...zori.keys(), ...zhvi.keys()])];
const BATCH = 2000;
for (let i = 0; i < zips.length; i += BATCH) {
  const chunk = zips.slice(i, i + BATCH);
  const col = (map, key) => chunk.map((z) => map.get(z)?.[key] ?? null);
  await sql`
    INSERT INTO market_trends (zip, zori, zori_yoy, zori_as_of, zhvi, zhvi_yoy, zhvi_as_of)
    SELECT * FROM unnest(
      ${chunk}::text[],
      ${col(zori, "value")}::float8[], ${col(zori, "yoy")}::float8[], ${col(zori, "asOf")}::date[],
      ${col(zhvi, "value")}::float8[], ${col(zhvi, "yoy")}::float8[], ${col(zhvi, "asOf")}::date[]
    )
    ON CONFLICT (zip) DO UPDATE SET
      zori = EXCLUDED.zori, zori_yoy = EXCLUDED.zori_yoy, zori_as_of = EXCLUDED.zori_as_of,
      zhvi = EXCLUDED.zhvi, zhvi_yoy = EXCLUDED.zhvi_yoy, zhvi_as_of = EXCLUDED.zhvi_as_of,
      updated_at = now()`;
  console.log(`  saved ${Math.min(i + BATCH, zips.length)} / ${zips.length}`);
}
console.log("Done.");
