import { ensureTables, sql } from "./db";
import { formatCents, formatShortDate, PASS_DAYS, PLANS, REANALYSIS_PRICE, SEARCH_PRICE } from "./plans";

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
  return (await searchUsage(userId, tier)).used;
}

// { used, nextFree }: how many of the plan's searches were used in the last
// 30 days, and when the oldest one stops counting (null if none used).
async function searchUsage(userId, tier) {
  await ensureTables();
  const [{ used, oldest }] = await sql`
    SELECT count(*) AS used, min(created_at) AS oldest FROM search_passes
    WHERE user_id = ${userId} AND source = ${tier}
      AND created_at > now() - interval '30 days'`;
  return { used: Number(used), nextFree: oldest ? addDays(oldest, 30) : null };
}

// Same for new AI analyses (saved ones reopened for free don't count).
async function aiUsage(userId) {
  await ensureTables();
  const [{ used, oldest }] = await sql`
    SELECT count(*) AS used, min(requested_at) AS oldest FROM ai_requests
    WHERE user_id = ${userId} AND requested_at > now() - interval '30 days'`;
  return { used: Number(used), nextFree: oldest ? addDays(oldest, 30) : null };
}

const addDays = (d, days) => new Date(new Date(d).getTime() + days * 86_400_000).toISOString();

// What the user's plan includes and how much is left, for the pages:
// { plan, searches: { used, max, nextFree }, ai: { used, max, nextFree } | null }.
// Null for pay-per-search and full-access accounts (nothing to count).
export async function planUsage(userId, access) {
  const { tier, plan, fullAccess } = access;
  if (fullAccess || tier === "free") return null;
  const [searches, ai] = await Promise.all([
    searchUsage(userId, tier),
    plan.aiPer30Days ? aiUsage(userId) : null,
  ]);
  return {
    plan: plan.name,
    searches: { ...searches, max: plan.searchesPer30Days },
    ai: ai && { ...ai, max: plan.aiPer30Days },
  };
}

// Makes sure the user may load this search: an open pass, a search left on
// their plan (which opens one), or full access. Otherwise PaymentRequired.
export async function ensureSearchAccess(userId, access, searchKey) {
  const { tier, plan, fullAccess } = access;
  if (fullAccess) return { source: "full" };
  const pass = await getPass(userId, searchKey);
  if (pass) return { source: pass.source, pass };

  let planNote = "";
  if (tier !== "free" && plan.searchesPer30Days > 0) {
    const { used, nextFree } = await searchUsage(userId, tier);
    if (used < plan.searchesPer30Days) {
      await grantPass(userId, searchKey, tier);
      return { source: tier, pass: await getPass(userId, searchKey) };
    }
    planNote =
      `You've used all ${plan.searchesPer30Days} searches in your ${plan.name} plan for the last 30 days` +
      (nextFree ? ` (the next one frees up ${formatShortDate(nextFree)}). ` : ". ");
  }

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
  // Pro: covered while the plan's analyses for the last 30 days last.
  // (Nothing to commit: the analysis is counted in ai_requests when it runs.)
  let planNote = "";
  if (plan.aiPer30Days) {
    const { used, nextFree } = await aiUsage(userId);
    if (used < plan.aiPer30Days) return { ...none, covered: "plan" };
    planNote =
      `You've used all ${plan.aiPer30Days} AI analyses in your ${plan.name} plan for the last 30 days` +
      (nextFree ? ` (the next one frees up ${formatShortDate(nextFree)}). ` : ". ");
  }

  // Otherwise a paid re-analysis credit for this search.
  await ensureTables();
  const [credit] = await sql`
    SELECT id FROM purchases
    WHERE user_id = ${userId} AND search_key = ${searchKey} AND kind = 'reanalysis' AND used_at IS NULL
    ORDER BY created_at LIMIT 1`;
  if (!credit) {
    throw new PaymentRequired(`${planNote}This re-analysis costs ${formatCents(REANALYSIS_PRICE)}.`, {
      kind: "reanalysis",
      price: REANALYSIS_PRICE,
    });
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
