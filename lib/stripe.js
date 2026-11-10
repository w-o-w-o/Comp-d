import Stripe from "stripe";
import { ensureTables, sql } from "./db";
import { PLANS } from "./plans";

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PAID_TIERS = ["basic", "advanced"];
const priceIds = {};

// Finds this plan's monthly price in Stripe (by lookup key), creating the
// product and price the first time so there's nothing to set up by hand.
export async function priceIdFor(tier) {
  if (priceIds[tier]) return priceIds[tier];
  const lookupKey = `compd_${tier}_monthly`;
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  let price = data[0];
  if (!price) {
    price = await stripe.prices.create({
      lookup_key: lookupKey,
      currency: "usd",
      unit_amount: PLANS[tier].price,
      recurring: { interval: "month" },
      product_data: { name: `Comp'd ${PLANS[tier].name}` },
      metadata: { tier },
    });
  }
  priceIds[tier] = price.id;
  return price.id;
}

// Reuses the user's Stripe customer, or creates one linked to their account.
export async function customerIdFor(userId, email) {
  await ensureTables();
  const [row] = await sql`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}`;
  if (row) return row.stripe_customer_id;

  const customer = await stripe.customers.create({ email, metadata: { userId } });
  await sql`
    INSERT INTO subscriptions (user_id, stripe_customer_id) VALUES (${userId}, ${customer.id})
    ON CONFLICT (user_id) DO NOTHING`;
  const [saved] = await sql`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}`;
  return saved.stripe_customer_id;
}

// Saves a Stripe subscription's current state for its user.
export async function saveSubscription(subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const item = subscription.items?.data?.[0];
  const tier = subscription.metadata?.tier || item?.price?.metadata?.tier;
  const periodEnd = item?.current_period_end;

  await ensureTables();
  await sql`
    UPDATE subscriptions SET
      stripe_subscription_id = ${subscription.id},
      tier = ${PAID_TIERS.includes(tier) ? tier : "free"},
      status = ${subscription.status},
      current_period_end = ${periodEnd ? new Date(periodEnd * 1000) : null},
      cancel_at_period_end = ${Boolean(subscription.cancel_at_period_end)},
      updated_at = now()
    WHERE stripe_customer_id = ${customerId}`;
}

export function isPaidTier(tier) {
  return PAID_TIERS.includes(tier);
}
