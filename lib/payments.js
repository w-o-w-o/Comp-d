import { applyPurchase, grantPass } from "./access";
import { REANALYSIS_PRICE, SEARCH_PRICE, TAB_HOLD } from "./plans";
import { customerIdFor, stripe } from "./stripe";
import { addToTab, closeTab, getOpenTab, openTab, searchOnTab } from "./tabs";
import { sql } from "./db";

// Pay-per-use payments. Searches and re-analyses go on a tab: a $5 hold on the
// card, charged once for what was used (see lib/tabs.js). The first payment
// goes through Stripe Checkout, which saves the card to the user's Stripe
// customer (Stripe holds the card; the app never sees its number). Later ones
// use that saved card directly, after the user confirms on the page.

export const PRODUCTS = {
  search: {
    price: SEARCH_PRICE,
    name: "Comp'd search",
    description: "Listings for 7 days, 1 AI analysis and commute checks",
  },
  reanalysis: {
    price: REANALYSIS_PRICE,
    name: "Comp'd AI re-analysis",
    description: "One more AI analysis of a search",
  },
  // Holds, not charges: only what's used is charged, when the tab closes.
  tab: {
    price: TAB_HOLD,
    hold: true,
    name: "Comp'd tab (hold)",
    description: `A temporary hold. You're charged only for what you use: ${usd(REANALYSIS_PRICE)} per AI re-analysis`,
  },
  // A new tab that starts with a search on it.
  searchtab: {
    price: TAB_HOLD,
    hold: true,
    withSearch: true,
    name: "Comp'd tab (hold)",
    description:
      `A temporary hold. You're charged only for what you use: ${usd(SEARCH_PRICE)} for this search and its ` +
      `first AI analysis, +${usd(REANALYSIS_PRICE)} per re-analysis. The rest is released`,
  },
};

function usd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// After a payment goes through: opens the tab (a hold), putting the search on
// it when it came with one, or applies a regular purchase.
async function applyPaid({ userId, kind, searchKey, amount, paymentIntent }) {
  const product = PRODUCTS[kind];
  if (!product.hold) return applyPurchase({ userId, kind, searchKey, amount, paymentIntent });
  // (If another tab was opened meanwhile, the extra hold is released and the search goes on that one.)
  const tab = (await openTab(userId, paymentIntent, amount)) || (await getOpenTab(userId));
  if (product.withSearch && tab && !(await searchOnTab(tab.id, searchKey))) {
    if (!(await addToTab(tab, SEARCH_PRICE, searchKey, "search"))) return false;
    await grantPass(userId, searchKey, "paid");
  }
  return Boolean(tab);
}

// Pays for a search on the user's tab: on the open tab if it has room;
// otherwise that tab is charged now and a new $5 hold starts with the search on
// it (saved card, or Stripe Checkout). -> { ok: true } or { checkoutUrl }.
export async function payForSearch({ userId, email, searchKey, label, useSavedCard, origin, returnTo }) {
  let tab = await getOpenTab(userId);
  if (tab && tab.hold_cents - tab.used_cents >= SEARCH_PRICE) {
    if (await addToTab(tab, SEARCH_PRICE, searchKey, "search")) {
      await grantPass(userId, searchKey, "paid");
      return { ok: true };
    }
    tab = await getOpenTab(userId); // it closed meanwhile
  }
  if (tab) await closeTab(tab, "full");

  const customerId = await customerIdFor(userId, email);
  const card = useSavedCard ? await savedCard(customerId) : null;
  if (card) {
    const result = await chargeSavedCard({ userId, customerId, card, kind: "searchtab", searchKey, label });
    if (result.ok) return { ok: true };
    // The bank wants confirmation, or the card failed: Stripe's page instead.
  }
  const checkoutUrl = await checkoutFor({ userId, email, kind: "searchtab", searchKey, label, origin, returnTo });
  return { checkoutUrl, savedCardFailed: Boolean(card) };
}

// The card Stripe has on file for this customer: { id, brand, last4 } or null.
export async function savedCard(customerId) {
  if (!stripe || !customerId) return null;
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (customer.deleted) return null;
  let pm = customer.invoice_settings?.default_payment_method;
  if (!pm || typeof pm === "string") {
    const { data } = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    pm = data[0];
  }
  return pm?.card ? { id: pm.id, brand: pm.card.brand, last4: pm.card.last4 } : null;
}

// Charges the saved card. Returns { ok: true } or { ok: false, reason } when
// the bank wants the user to confirm (or the card failed), so the page can
// fall back to Stripe Checkout.
export async function chargeSavedCard({ userId, customerId, card, kind, searchKey, label }) {
  const product = PRODUCTS[kind];
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: product.price,
        currency: "usd",
        customer: customerId,
        payment_method: card.id,
        off_session: true,
        confirm: true,
        // A hold is authorized now and charged (partly) when the tab closes.
        ...(product.hold && { capture_method: "manual" }),
        description: `${product.name}: ${label}`.slice(0, 200),
        metadata: { userId, kind, searchKey },
      },
      // One charge per click even if the request is retried.
      { idempotencyKey: `${userId}|${kind}|${searchKey}|${Math.floor(Date.now() / 5000)}` }
    );
    const done = product.hold ? "requires_capture" : "succeeded";
    if (intent.status !== done) return { ok: false, reason: intent.status };
    await applyPaid({ userId, kind, searchKey, amount: product.price, paymentIntent: intent.id });
    return { ok: true };
  } catch (err) {
    // card_declined, authentication_required, expired_card, ...
    console.error("Saved-card charge failed:", err.code || err.message);
    return { ok: false, reason: err.code || "card_error" };
  }
}

// Starts a new tab on the saved card after the last one filled up (see
// canRenewTab). Returns the new tab, or null if there's no card or the bank
// declined (the user is then asked, as for a first tab).
export async function renewTab(userId) {
  const [row] = await sql`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}`;
  const card = await savedCard(row?.stripe_customer_id);
  if (!card) return null;
  // Named after the tab it replaces, so each renewal is its own Stripe request.
  const [last] = await sql`SELECT id FROM tabs WHERE user_id = ${userId} ORDER BY opened_at DESC LIMIT 1`;
  const result = await chargeSavedCard({
    userId,
    customerId: row.stripe_customer_id,
    card,
    kind: "tab",
    searchKey: `renewal-after-${last?.id ?? 0}`,
    label: "new tab after the last one filled up",
  });
  return result.ok ? getOpenTab(userId) : null;
}

// Stripe Checkout for one pay-per-use item; saves the card for next time.
export async function checkoutFor({ userId, email, kind, searchKey, label, origin, returnTo }) {
  const product = PRODUCTS[kind];
  const customer = await customerIdFor(userId, email);
  const metadata = { userId, kind, searchKey };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: userId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: product.price,
          product_data: { name: product.name, description: `${product.description} — ${label}`.slice(0, 300) },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata,
      ...(product.hold && { capture_method: "manual" }),
    },
    metadata,
    success_url: `${origin}/api/purchase/complete?session_id={CHECKOUT_SESSION_ID}&return=${encodeURIComponent(returnTo)}`,
    cancel_url: `${origin}${returnTo}`,
  });
  return session.url;
}

// Applies a finished Checkout payment (from the return page or the webhook).
export async function completeCheckout(sessionOrId, expectedUserId = null) {
  const session =
    typeof sessionOrId === "string" ? await stripe.checkout.sessions.retrieve(sessionOrId) : sessionOrId;
  const { userId, kind, searchKey } = session.metadata || {};
  if (session.mode !== "payment" || session.status !== "complete" || !PRODUCTS[kind] || !userId) return false;
  if (expectedUserId && userId !== expectedUserId) return false;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  // A charge must be paid; a hold must be authorized (Checkout reports a hold
  // as "unpaid" until it's charged, so check the payment itself).
  if (PRODUCTS[kind].hold) {
    const pi = paymentIntent && (await stripe.paymentIntents.retrieve(paymentIntent));
    if (pi?.status !== "requires_capture") return false;
  } else if (session.payment_status !== "paid") {
    return false;
  }

  // Make the saved card the default for one-click payments next time.
  if (paymentIntent && session.customer) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntent);
      if (pi.payment_method) {
        await stripe.customers.update(session.customer, {
          invoice_settings: { default_payment_method: pi.payment_method },
        });
      }
    } catch (err) {
      console.error("Couldn't set the default card:", err.message);
    }
  }
  await applyPaid({ userId, kind, searchKey, amount: session.amount_total ?? PRODUCTS[kind].price, paymentIntent });
  return true;
}
