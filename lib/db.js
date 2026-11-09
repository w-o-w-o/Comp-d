import { neon } from "@neondatabase/serverless";

// Neon Postgres. Vercel's Neon integration sets DATABASE_URL.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const sql = url ? neon(url) : null;

let tablesReady = null;

// Creates the tables Comp'd needs the first time the server uses the database.
export function ensureTables() {
  tablesReady ??= (async () => {
    // Saved RentCast responses, so repeat searches don't spend paid requests.
    await sql`
      CREATE TABLE IF NOT EXISTS rentcast_cache (
        key text PRIMARY KEY,
        data jsonb NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now()
      )`;
    // One row per paid RentCast request, used to enforce the request budget.
    await sql`
      CREATE TABLE IF NOT EXISTS rentcast_requests (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        endpoint text NOT NULL,
        requested_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Saved AI recommendations, keyed by the exact data the AI was shown.
    await sql`
      CREATE TABLE IF NOT EXISTS ai_cache (
        key text PRIMARY KEY,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    // One row per Claude API call, used to enforce AI usage limits.
    await sql`
      CREATE TABLE IF NOT EXISTS ai_requests (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        requested_at timestamptz NOT NULL DEFAULT now()
      )`;
  })().catch((err) => {
    tablesReady = null; // retry on the next request
    throw err;
  });
  return tablesReady;
}
