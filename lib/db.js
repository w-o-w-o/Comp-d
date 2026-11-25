import { neon } from "@neondatabase/serverless";

// Neon Postgres. Vercel's Neon integration sets DATABASE_URL.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const sql = url ? neon(url) : null;

let tablesReady = null;

// Creates the tables Comp'd needs the first time the server uses the database.
export function ensureTables() {
  // Two requests creating the same new table at once can collide (23505);
  // the other one finished it, so trying once more succeeds.
  tablesReady ??= createTables().catch((err) => {
    if (err?.code === "23505") return createTables();
    throw err;
  }).catch((err) => {
    tablesReady = null; // retry on the next request
    throw err;
  });
  return tablesReady;
}

function createTables() {
  return (async () => {
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
    // Each user's Stripe subscription, kept in sync by checkout and the webhook.
    await sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id text PRIMARY KEY,
        stripe_customer_id text NOT NULL,
        stripe_subscription_id text,
        tier text NOT NULL DEFAULT 'free',
        status text NOT NULL DEFAULT 'none',
        current_period_end timestamptz,
        cancel_at_period_end boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Distinct area searches per user, for the Free plan's search limit.
    await sql`
      CREATE TABLE IF NOT EXISTS search_usage (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        search_key text NOT NULL,
        searched_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Each user's past searches, one row per place and rent/buy choice.
    await sql`
      CREATE TABLE IF NOT EXISTS search_history (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        search_key text NOT NULL,
        address text NOT NULL,
        formatted_address text,
        place_id text,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        mode text NOT NULL,
        radius_miles double precision NOT NULL,
        estimate_amount double precision,
        listing_count integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_viewed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, search_key)
      )`;
    // When the search's RentCast listings were fetched; the entry expires
    // with that data (see lib/history.js).
    await sql`ALTER TABLE search_history ADD COLUMN IF NOT EXISTS data_fetched_at timestamptz`;
    // Saved answers from the public data sources (Census, HUD, FEMA).
    await sql`
      CREATE TABLE IF NOT EXISTS area_cache (
        key text PRIMARY KEY,
        data jsonb,
        fetched_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Zillow rent and home value trends by ZIP (filled by scripts/import-market-trends.mjs).
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
    // Commute checks saved with a search (at most 3 per search; lib/commutes.js).
    await sql`
      CREATE TABLE IF NOT EXISTS commute_checks (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        search_key text NOT NULL,
        destination text NOT NULL,
        travel_mode text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, search_key, destination, travel_mode)
      )`;
    // Each search a user has unlocked (paid for, or from their plan), with
    // whether its included AI analysis has been used (lib/access.js).
    await sql`
      CREATE TABLE IF NOT EXISTS search_passes (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        search_key text NOT NULL,
        source text NOT NULL,
        ai_included_used boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, search_key)
      )`;
    // Every pay-per-use charge. Re-analysis rows are credits until used.
    await sql`
      CREATE TABLE IF NOT EXISTS purchases (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        kind text NOT NULL,
        search_key text NOT NULL,
        amount_cents integer NOT NULL,
        stripe_payment_intent text UNIQUE,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Custom AI analyses used in the weekly demo (one per account per week).
    await sql`
      CREATE TABLE IF NOT EXISTS demo_usage (
        user_id text NOT NULL,
        week text NOT NULL,
        ai_used integer NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, week)
      )`;
    // Re-analysis tabs: a hold on the user's card (a Stripe payment authorized
    // but not yet charged), what they've used of it, and how it ended. One open
    // tab per user at a time.
    await sql`
      CREATE TABLE IF NOT EXISTS tabs (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        stripe_payment_intent text UNIQUE NOT NULL,
        hold_cents integer NOT NULL,
        used_cents integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'open',
        charged_cents integer,
        opened_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz
      )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS tabs_one_open ON tabs (user_id) WHERE status = 'open'`;
    // Why a tab closed: "full" (the next item didn't fit) or "time" (24 hours).
    await sql`ALTER TABLE tabs ADD COLUMN IF NOT EXISTS close_reason text`;
    await sql`
      CREATE TABLE IF NOT EXISTS tab_items (
        id bigserial PRIMARY KEY,
        tab_id bigint NOT NULL,
        search_key text NOT NULL,
        amount_cents integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    // "search" (a search and its first analysis) or "reanalysis".
    await sql`ALTER TABLE tab_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'reanalysis'`;
    // Basic plan credits spent: one row per search (5) or re-analysis (1).
    await sql`
      CREATE TABLE IF NOT EXISTS plan_credits (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        kind text NOT NULL,
        search_key text NOT NULL,
        credits integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Each user's AI analyses, to look back on: the result plus a snapshot of
    // the picked listings (they may be gone from later listing data).
    await sql`
      CREATE TABLE IF NOT EXISTS ai_analyses (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        search_key text NOT NULL,
        analysis_key text NOT NULL,
        address text NOT NULL,
        mode text NOT NULL,
        radius_miles real NOT NULL,
        demo boolean NOT NULL DEFAULT false,
        label text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, analysis_key)
      )`;
    // One row per Claude API call, used to enforce AI usage limits.
    await sql`
      CREATE TABLE IF NOT EXISTS ai_requests (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        requested_at timestamptz NOT NULL DEFAULT now()
      )`;
  })();
}
