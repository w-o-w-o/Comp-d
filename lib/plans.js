import { currentUser } from "@clerk/nextjs/server";
import { ensureTables, sql } from "./db";

// Pay-per-use prices and credit costs live in lib/prices.js (browser-safe).
export { CREDIT_COST, REANALYSIS_PRICE, SEARCH_PRICE, TAB_HOLD, TAB_HOURS } from "./prices";
// How long a paid search (and its included extras) stays open: the same 7
// days the listing data is kept.
export const PASS_DAYS = 7;

// What each plan includes. Prices are US cents per month. "free" is the
// no-subscription state: every search is paid for individually.
// Limits count over the last 30 days (rolling), and every one is shown to the
// user before they reach it. Past a limit, searches and analyses are paid
// individually, like pay-per-search, so nobody hits a dead end.
// newAddressesPerDay is only a safety net against scripts; normal use stays
// well under it.
export const PLANS = {
  free: {
    name: "Pay per search",
    price: 0,
    creditsPer30Days: 0, // each search and re-analysis is paid (on a tab)
    commutesPerSearch: 3,
    newAddressesPerDay: 10,
  },
  // A pool of credits to spend however the user likes: a search (with its
  // first AI analysis) uses CREDIT_COST.search, each re-analysis
  // CREDIT_COST.reanalysis.
  basic: {
    name: "Basic",
    price: 1500,
    creditsPer30Days: 50,
    commutesPerSearch: 3,
    newAddressesPerDay: 10,
  },
  // Same credits as Basic, a bigger and cheaper pool.
  advanced: {
    name: "Pro",
    price: 2900,
    creditsPer30Days: 150,
    commutesPerSearch: 10,
    newAddressesPerDay: 20,
  },
};

// Shown when a date is far enough off that the weekday alone isn't clear.
export const formatShortDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Accounts that get every feature without paying (e.g. the class demo account).
// Comma-separated emails in FULL_ACCESS_EMAILS.
function fullAccessEmails() {
  return (process.env.FULL_ACCESS_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Subscription statuses that keep a paid plan active.
const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

// The user's email addresses, remembered for a few minutes so each API call
// doesn't ask Clerk again (its API has rate limits). If Clerk can't be reached,
// the last known emails are used (or none).
const EMAILS_TTL_MS = 5 * 60_000;
const emailCache = new Map();
async function userEmails(userId) {
  const hit = emailCache.get(userId);
  if (hit && Date.now() - hit.at < EMAILS_TTL_MS) return hit.emails;
  try {
    const user = await currentUser();
    const emails = (user?.emailAddresses || []).map((e) => e.emailAddress.toLowerCase());
    emailCache.set(userId, { emails, at: Date.now() });
    return emails;
  } catch (err) {
    console.error("Couldn't load the user from Clerk:", err.message);
    return hit?.emails || [];
  }
}

// Returns { tier, plan, subscription, fullAccess } for the logged-in user.
export async function getUserPlan(userId) {
  const emails = await userEmails(userId);
  if (emails.some((e) => fullAccessEmails().includes(e))) {
    return { tier: "advanced", plan: PLANS.advanced, subscription: null, fullAccess: true };
  }

  if (!sql) return { tier: "free", plan: PLANS.free, subscription: null, fullAccess: false };
  await ensureTables();
  const [subscription] = await sql`
    SELECT * FROM subscriptions WHERE user_id = ${userId}`;
  const active =
    subscription &&
    ACTIVE_STATUSES.includes(subscription.status) &&
    subscription.tier !== "free" &&
    PLANS[subscription.tier];
  const tier = active ? subscription.tier : "free";
  return { tier, plan: PLANS[tier], subscription: subscription || null, fullAccess: false };
}

export const formatCents = (c) => `$${(c / 100).toFixed(2)}`;
