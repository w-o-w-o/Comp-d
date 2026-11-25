import { ensureTables, sql } from "./db";

// Each user's AI analyses, saved so they can look back on them (the results
// page lists earlier ones for the same address). Running the same analysis
// again just moves it to the top.

const MAX_PER_SEARCH = 10;

// "Budget, In-unit laundry, “dishwasher”" from the priorities sent to the AI.
export function analysisLabel(priorities) {
  const names = [
    ...(priorities?.priorities || []).map((p) => p.name),
    ...(priorities?.customPriorities || []).map((c) => `“${c}”`),
  ];
  return names.length ? names.join(", ") : "Standard analysis";
}

// Saves an analysis for the user. `listings` are the homes the AI saw, so the
// picks can be shown later as they were (price, size, distance).
export async function saveAnalysis({ userId, searchKey, address, mode, radiusMiles, demo, label, result, listings }) {
  if (!result?.analysisKey) return;
  const byId = new Map(listings.map((l) => [l.id, l]));
  const pickListings = result.recommendations
    .map((r) => byId.get(r.listingId))
    .filter(Boolean)
    .map((l) => ({
      id: l.id,
      address: l.address,
      price: l.price,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      type: l.type,
      distance: l.distance,
    }));
  // eslint-disable-next-line no-unused-vars
  const { usage, tab, cached, ...saved } = result;
  await ensureTables();
  await sql`
    INSERT INTO ai_analyses (user_id, search_key, analysis_key, address, mode, radius_miles, demo, label, result)
    VALUES (${userId}, ${searchKey}, ${result.analysisKey}, ${address}, ${mode}, ${radiusMiles}, ${Boolean(demo)},
            ${label}, ${JSON.stringify({ ...saved, pickListings })}::jsonb)
    ON CONFLICT (user_id, analysis_key) DO UPDATE SET created_at = now()`;
}

// The user's analyses of one search (address and rent/buy), newest first.
export async function analysesFor(userId, searchKey) {
  await ensureTables();
  return sql`
    SELECT id, analysis_key, label, radius_miles, result, created_at FROM ai_analyses
    WHERE user_id = ${userId} AND search_key = ${searchKey}
    ORDER BY created_at DESC LIMIT ${MAX_PER_SEARCH}`;
}
