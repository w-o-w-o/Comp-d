import { ensureTables, sql } from "./db";
import { PASS_DAYS, PLANS, REANALYSIS_PRICE, SEARCH_PRICE } from "./plans";

// Who may load a search, run an AI analysis, or check commutes, and what it
// costs. A "search" is one place (address) and rent/buy choice, the same key
// the history and commute checks use; once unlocked it stays open for
// PASS_DAYS, radius changes included.

export function searchKeyFor(lat, lng, mode) {
  return `${mode === "buy" ? "buy" : "rent"}|${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// Thrown when something needs paying for. `payment` tells the page what to offer.
export class PaymentRequired extends Error {
  constructor(message, payment) {
    super(message);
    this.payment = payment;
  }
}

export async function getPass(userId, searchKey) {
  await ensureTables();
  const [pass] = await sql`
    SELECT * FROM search_passes
    WHERE user_id = ${userId} AND search_key = ${searchKey}
      AND created_at > now() - make_interval(days => ${PASS_DAYS})`;
  return pass || null;
}

// Opens (or re-opens, after it expired) a search for the user.
export async function grantPass(userId, searchKey, source) {
  await ensureTables();
  await sql`
    INSERT INTO search_passes (user_id, search_key, source)
    VALUES (${userId}, ${searchKey}, ${source})
    ON CONFLICT (user_id, search_key) DO UPDATE SET
      source = EXCLUDED.source, ai_included_used = false, created_at = now()
    WHERE search_passes.created_at <= now() - make_interval(days => ${PASS_DAYS})`;
}

// Searches the user's plan has opened in the last 30 days.
export async function planSearchesUsed(userId, tier) {
  await ensureTables();
  const [{ used }] = await sql`
    SELECT count(*) AS used FROM search_passes
    WHERE user_id = ${userId} AND source = ${tier}
      AND created_at > now() - interval '30 days'`;
  return Number(used);
}

// Makes sure the user may load this search: an open pass, a search left on
// their plan (which opens one), or full access. Otherwise PaymentRequired.
export async function ensureSearchAccess(userId, access, searchKey) {
  const { tier, plan, fullAccess } = access;
  if (fullAccess) return { source: "full" };
  const pass = await getPass(userId, searchKey);
  if (pass) return { source: pass.source, pass };

  if (tier !== "free" && plan.searchesPer30Days > 0) {
    const used = await planSearchesUsed(userId, tier);
    if (used < plan.searchesPer30Days) {
      await grantPass(userId, searchKey, tier);
      return { source: tier, pass: await getPass(userId, searchKey) };
    }
  }

  const planNote =
    tier === "basic"
      ? `You've used the ${PLANS.basic.searchesPer30Days} searches in your Basic plan this month. `
      : tier === "advanced"
        ? "You've reached this month's fair-use limit for Unlimited. "
        : "";
  throw new PaymentRequired(`${planNote}Unlock this search to see its homes.`, {
    kind: "search",
    price: SEARCH_PRICE,
  });
}

// Before a new AI analysis (not a saved one): decides how it's covered.
// Returns { commit, release }: commit() after the analysis succeeds uses up
// what covered it; release() undoes nothing (kept for symmetry and clarity).
export async function claimAnalysis(userId, access, searchKey, { demo = null } = {}) {
  const { plan, fullAccess } = access;
  const none = { covered: "full", commit: async () => {}, release: async () => {} };
  if (fullAccess) return none;

  // Weekly demo: the shared default analysis is free; each account gets one
  // custom analysis per week.
  if (demo) {
    if (demo.isDefault) return { ...none, covered: "demo-default" };
    await ensureTables();
    const [row] = await sql`SELECT ai_used FROM demo_usage WHERE user_id = ${userId} AND week = ${demo.week}`;
    if ((row?.ai_used ?? 0) >= 1) {
      throw new PaymentRequired(
        "The demo includes one custom analysis per week. Search your own address to analyze more.",
        { kind: "demo-limit" }
      );
    }
    return {
      covered: "demo",
      commit: () => sql`
        INSERT INTO demo_usage (user_id, week, ai_used) VALUES (${userId}, ${demo.week}, 1)
        ON CONFLICT (user_id, week) DO UPDATE SET ai_used = demo_usage.ai_used + 1`,
      release: async () => {},
    };
  }

  const pass = await getPass(userId, searchKey);
  if (!pass) {
    throw new PaymentRequired("Unlock this search first.", { kind: "search", price: SEARCH_PRICE });
  }
  // The analysis every search includes.
  if (!pass.ai_included_used) {
    return {
      covered: "included",
      commit: () => sql`UPDATE search_passes SET ai_included_used = true WHERE id = ${pass.id}`,
      release: async () => {},
    };
  }
  // Unlimited: within the daily fair-use cap (enforced by lib/recommend.js).
  if (plan.unlimitedAi) return { ...none, covered: "plan" };

  // Otherwise a paid re-analysis credit for this search.
  await ensureTables();
  const [credit] = await sql`
    SELECT id FROM purchases
    WHERE user_id = ${userId} AND search_key = ${searchKey} AND kind = 'reanalysis' AND used_at IS NULL
    ORDER BY created_at LIMIT 1`;
  if (!credit) {
    throw new PaymentRequired("This re-analysis costs $0.50.", { kind: "reanalysis", price: REANALYSIS_PRICE });
  }
  return {
    covered: "credit",
    commit: () => sql`UPDATE purchases SET used_at = now() WHERE id = ${credit.id} AND used_at IS NULL`,
    release: async () => {},
  };
}

// Applies a completed payment (idempotent: the payment intent is recorded once).
export async function applyPurchase({ userId, kind, searchKey, amount, paymentIntent }) {
  await ensureTables();
  const inserted = await sql`
    INSERT INTO purchases (user_id, kind, search_key, amount_cents, stripe_payment_intent)
    VALUES (${userId}, ${kind}, ${searchKey}, ${amount}, ${paymentIntent})
    ON CONFLICT (stripe_payment_intent) DO NOTHING
    RETURNING id`;
  if (!inserted.length) return false; // already applied
  // grantPass starts a fresh pass, or renews one that has expired.
  if (kind === "search") await grantPass(userId, searchKey, "paid");
  return true;
}

// Commute checks allowed per search for this user.
export function commuteLimitFor(access, { demo = false } = {}) {
  if (demo) return 0; // the demo shows a preset commute instead
  if (access.fullAccess) return PLANS.advanced.commutesPerSearch;
  return access.plan.commutesPerSearch;
}
