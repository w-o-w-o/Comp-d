import { currentUser } from "@clerk/nextjs/server";
import { ensureTables, sql } from "./db";

// Pay-per-use prices, in US cents.
export const SEARCH_PRICE = 250; // one search: listings for 7 days, 1 AI analysis, commute checks
export const REANALYSIS_PRICE = 50; // each AI analysis after the one a search includes
// How long a paid search (and its included extras) stays open: the same 7
// days the listing data is kept.
export const PASS_DAYS = 7;

// What each plan includes. Prices are US cents per month. "free" is the
// no-subscription state: every search is paid for individually.
export const PLANS = {
  free: {
    name: "Pay per search",
    price: 0,
    searchesPer30Days: 0,
    aiPerDay: null, // no daily cap: each extra analysis is paid for
    commutesPerSearch: 3,
  },
  basic: {
    name: "Basic",
    price: 1000,
    searchesPer30Days: 6, // each with 1 AI analysis and 3 commute checks
    aiPerDay: null, // extra analyses are paid, like pay-per-search
    commutesPerSearch: 3,
  },
  advanced: {
    name: "Unlimited",
    price: 2500,
    // "Unlimited" with a fair-use ceiling far above normal use, so a script
    // can't run up the data and AI bills.
    searchesPer30Days: 40,
    aiPerDay: 15,
    commutesPerSearch: 10,
    unlimitedAi: true,
  },
};

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
