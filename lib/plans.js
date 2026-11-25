import { currentUser } from "@clerk/nextjs/server";
import { ensureTables, sql } from "./db";

// Pay-per-use prices, in US cents.
export const SEARCH_PRICE = 250; // one search: listings for 7 days, 1 AI analysis, commute checks
export const REANALYSIS_PRICE = 50; // each AI analysis after the one a search includes
// Re-analyses go on a tab: TAB_HOLD is held on the card when the tab opens, and
// only what was used is charged, in one payment, when the tab closes (full, or
// TAB_HOURS after it opened). One Stripe fee per tab instead of one per $0.50.
// Stripe's smallest charge is $0.50, so REANALYSIS_PRICE must stay at least 50.
export const TAB_HOLD = 500;
// Basic plan credits, in proportion to the pay-per-use prices ($2.50 : $0.50).
export const CREDIT_COST = { search: 5, reanalysis: 1 };
export const TAB_HOURS = 24;
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
    searchesPer30Days: 0,
    aiPer30Days: 0, // the analysis each search includes; extras are paid
    commutesPerSearch: 3,
    newAddressesPerDay: 10,
  },
  // A pool of credits to spend however the user likes: a search (with its
  // first AI analysis) uses CREDIT_COST.search, each re-analysis
  // CREDIT_COST.reanalysis. 50 credits = $25 at pay-per-search prices.
  basic: {
    name: "Basic",
    price: 1500,
    searchesPer30Days: 0,
    aiPer30Days: 0,
    creditsPer30Days: 50,
    commutesPerSearch: 3,
    newAddressesPerDay: 10,
  },
  advanced: {
    name: "Pro",
    price: 2900,
    searchesPer30Days: 30,
    aiPer30Days: 60, // every new analysis counts, including each search's first
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
