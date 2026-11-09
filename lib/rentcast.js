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
export async function rentcastGet(path, params, userId) {
  const query = new URLSearchParams(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  ).toString();
  const cacheKey = `${path}?${query}`;

  await ensureTables();
  const cached = await sql`
    SELECT data FROM rentcast_cache
    WHERE key = ${cacheKey}
      AND fetched_at > now() - make_interval(days => ${CACHE_DAYS})`;
  if (cached.length) return cached[0].data;

  const requestId = await reserveRequest(userId, path);
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
    if (response.status === 404) return null;
    throw new Error(`RentCast ${path} failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  await sql`
    INSERT INTO rentcast_cache (key, data) VALUES (${cacheKey}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
  return data;
}

// Records a request before it is made, then backs out if a limit is exceeded.
async function reserveRequest(userId, endpoint) {
  const [{ id }] = await sql`
    INSERT INTO rentcast_requests (user_id, endpoint) VALUES (${userId}, ${endpoint})
    RETURNING id`;
  const [{ total, mine }] = await sql`
    SELECT
      count(*) FILTER (WHERE requested_at > now() - interval '31 days') AS total,
      count(*) FILTER (WHERE user_id = ${userId} AND requested_at > now() - interval '1 day') AS mine
    FROM rentcast_requests`;

  if (Number(total) > MONTHLY_LIMIT) {
    await releaseRequest(id);
    throw new BudgetError("Comp'd has used this month's property data allowance.");
  }
  if (Number(mine) > USER_DAILY_LIMIT) {
    await releaseRequest(id);
    throw new BudgetError("You've reached today's limit of new property lookups.");
  }
  return id;
}

async function releaseRequest(id) {
  await sql`DELETE FROM rentcast_requests WHERE id = ${id}`;
}
