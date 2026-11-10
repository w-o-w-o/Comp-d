import { currentUser } from "@clerk/nextjs/server";
import { ensureTables, sql } from "./db";

// What each plan includes. Prices are in US cents per month.
// "searches" counts distinct area searches (new address, radius area, or
// rent/buy) per 30 days; repeating a search doesn't count again.
export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    searchesPer30Days: 3,
    aiPerDay: 0,
  },
  basic: {
    name: "Basic",
    price: 1000,
    searchesPer30Days: Infinity,
    aiPerDay: 3,
  },
  advanced: {
    name: "Advanced",
    price: 2000,
    searchesPer30Days: Infinity,
    aiPerDay: 10,
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

// Returns { tier, plan, subscription, fullAccess } for the logged-in user.
export async function getUserPlan(userId) {
  const user = await currentUser();
  const emails = (user?.emailAddresses || []).map((e) => e.emailAddress.toLowerCase());
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
    PLANS[subscription.tier];
  const tier = active ? subscription.tier : "free";
  return { tier, plan: PLANS[tier], subscription: subscription || null, fullAccess: false };
}

export class PlanLimitError extends Error {
  constructor(message, { upgradeTo } = {}) {
    super(message);
    this.upgradeTo = upgradeTo;
  }
}

// Records an area search for plan limits. Repeating the same search is free.
export async function checkSearchAllowance(userId, plan, searchKey) {
  if (plan.searchesPer30Days === Infinity) return;
  await ensureTables();
  const [{ used, seen }] = await sql`
    SELECT
      count(DISTINCT search_key) AS used,
      bool_or(search_key = ${searchKey}) AS seen
    FROM search_usage
    WHERE user_id = ${userId} AND searched_at > now() - interval '30 days'`;
  if (seen) return;
  if (Number(used) >= plan.searchesPer30Days) {
    throw new PlanLimitError(
      `The Free plan includes ${plan.searchesPer30Days} searches every 30 days. Upgrade to keep searching.`,
      { upgradeTo: "basic" }
    );
  }
  await sql`INSERT INTO search_usage (user_id, search_key) VALUES (${userId}, ${searchKey})`;
}

// Returns the user's remaining free searches, or null when unlimited.
export async function searchesLeft(userId, plan) {
  if (plan.searchesPer30Days === Infinity || !sql) return null;
  await ensureTables();
  const [{ used }] = await sql`
    SELECT count(DISTINCT search_key) AS used FROM search_usage
    WHERE user_id = ${userId} AND searched_at > now() - interval '30 days'`;
  return Math.max(0, plan.searchesPer30Days - Number(used));
}
