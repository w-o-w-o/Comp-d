import { ensureTables, sql } from "./db";

const BASE_URL = "https://api.rentcast.io/v1";

// RentCast's free plan includes 50 requests per month and then bills $0.20 per
// request with no automatic cap, so Comp'd enforces its own limits:
// at most RENTCAST_MONTHLY_LIMIT paid requests in any 31-day window (whatever
// day the billing cycle starts) and RENTCAST_USER_DAILY_LIMIT per user per day.
const MONTHLY_LIMIT = Number(process.env.RENTCAST_MONTHLY_LIMIT || 45);
const USER_DAILY_LIMIT = Number(process.env.RENTCAST_USER_DAILY_LIMIT || 10);
const CACHE_DAYS = 7;

export class BudgetError extends Error {}

// GET a RentCast endpoint, served from the Neon cache when possible.
// Returns null when RentCast has no data for the request (404).
// `addressesPerDay` (from the user's plan) sets their daily safety limit; a
// new address takes about 2 requests (listings and estimate).
export async function rentcastGet(path, params, userId, addressesPerDay = null) {
  return (await rentcastGetDated(path, params, userId, addressesPerDay)).data;
}

function cacheKeyFor(path, params) {
  const query = new URLSearchParams(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  ).toString();
  return { query, cacheKey: `${path}?${query}` };
}

async function readCache(cacheKey, days) {
  await ensureTables();
  const cached = await sql`
    SELECT data, fetched_at FROM rentcast_cache
    WHERE key = ${cacheKey}
      AND fetched_at > now() - make_interval(days => ${days})`;
  return cached.length ? { data: cached[0].data, fetchedAt: new Date(cached[0].fetched_at).toISOString() } : null;
}

// Same as rentcastGet, plus when the data was fetched: { data, fetchedAt }.
export async function rentcastGetDated(path, params, userId, addressesPerDay = null) {
  const { query, cacheKey } = cacheKeyFor(path, params);
  const hit = await readCache(cacheKey, CACHE_DAYS);
  if (hit) return hit;

  const requestId = await reserveRequest(userId, path, addressesPerDay);
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}?${query}`, {
      headers: { "X-Api-Key": process.env.RENTCAST_API_KEY, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    await releaseRequest(requestId);
    throw err;
  }

  // RentCast only bills successful (200) responses, so give failures back.
  if (!response.ok) {
    await releaseRequest(requestId);
    if (response.status === 404) return { data: null, fetchedAt: new Date().toISOString() };
    throw new Error(`RentCast ${path} failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  await sql`
    INSERT INTO rentcast_cache (key, data) VALUES (${cacheKey}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
  return { data, fetchedAt: new Date().toISOString() };
}

// Records a request before it is made, then backs out if a limit is exceeded.
async function reserveRequest(userId, endpoint, addressesPerDay) {
  const userLimit = addressesPerDay ? addressesPerDay * 2 : USER_DAILY_LIMIT;
  const [{ id }] = await sql`
    INSERT INTO rentcast_requests (user_id, endpoint) VALUES (${userId}, ${endpoint})
    RETURNING id`;
  const [{ total, mine, oldest }] = await sql`
    SELECT
      count(*) FILTER (WHERE requested_at > now() - interval '31 days') AS total,
      count(*) FILTER (WHERE user_id = ${userId} AND requested_at > now() - interval '1 day') AS mine,
      min(requested_at) FILTER (WHERE user_id = ${userId} AND requested_at > now() - interval '1 day') AS oldest
    FROM rentcast_requests`;

  if (Number(total) > MONTHLY_LIMIT) {
    await releaseRequest(id);
    console.error(`RENTCAST_MONTHLY_LIMIT (${MONTHLY_LIMIT}) reached: new addresses are paused. Raise it to resume.`);
    throw new BudgetError(
      "New addresses are paused on Comp'd's side for now. Addresses already searched in the last 7 days still open, and nothing was charged."
    );
  }
  if (Number(mine) > userLimit) {
    await releaseRequest(id);
    const hours = oldest ? Math.max(1, Math.ceil((new Date(oldest).getTime() + 86_400_000 - Date.now()) / 3_600_000)) : 24;
    throw new BudgetError(
      `You've reached today's limit of ${userLimit / 2} new addresses, a safety limit to block automated use. ` +
        `Addresses you've searched in the last 7 days still open, and you can search new ones again in about ${hours} ${hours === 1 ? "hour" : "hours"}.`
    );
  }
  return id;
}

async function releaseRequest(id) {
  await sql`DELETE FROM rentcast_requests WHERE id = ${id}`;
}
