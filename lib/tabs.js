import { ensureTables, sql } from "./db";
import { stripe } from "./stripe";
import { REANALYSIS_PRICE, TAB_HOLD, TAB_HOURS } from "./plans";

// Re-analysis tabs. Opening a tab puts a hold of TAB_HOLD on the user's card:
// the bank approves (or declines) right away and sets the money aside, but
// nothing is charged yet. Each re-analysis adds to the tab. When the tab closes
// (it can't fit another re-analysis, or TAB_HOURS have passed), only what was
// used is charged, in one payment, and the rest of the hold is released. A tab
// with nothing used is released entirely (no Stripe fee).

const HOUR_MS = 3_600_000;
export const tabClosesAt = (tab) => new Date(new Date(tab.opened_at).getTime() + TAB_HOURS * HOUR_MS);

// Records a hold that Stripe has authorized as the user's open tab. Returns
// the tab, or null if they already have one (the extra hold is released).
export async function openTab(userId, paymentIntentId, holdCents) {
  await ensureTables();
  const [tab] = await sql`
    INSERT INTO tabs (user_id, stripe_payment_intent, hold_cents)
    VALUES (${userId}, ${paymentIntentId}, ${holdCents})
    ON CONFLICT DO NOTHING
    RETURNING *`;
  if (tab) return tab;
  // Same payment applied twice (return page and webhook): that tab.
  const [same] = await sql`SELECT * FROM tabs WHERE stripe_payment_intent = ${paymentIntentId}`;
  if (same) return same;
  // A second hold while one is already open: let it go.
  await stripe.paymentIntents.cancel(paymentIntentId).catch((err) => console.error("Couldn't release extra hold:", err.message));
  return null;
}

// The user's open tab, or null. A tab past its time is closed (charged) first.
export async function getOpenTab(userId) {
  await ensureTables();
  const [tab] = await sql`SELECT * FROM tabs WHERE user_id = ${userId} AND status = 'open'`;
  if (!tab) return null;
  if (tabClosesAt(tab) <= new Date()) {
    await closeTab(tab);
    return null;
  }
  return tab;
}

// Adds a search ($2.50, with its first analysis) or a re-analysis ($0.50) to
// the tab. Closes (charges) the tab once not even a re-analysis fits. Returns
// false if the tab had no room (it closed meanwhile).
export async function addToTab(tab, amountCents, searchKey, kind = "reanalysis") {
  const [updated] = await sql`
    UPDATE tabs SET used_cents = used_cents + ${amountCents}
    WHERE id = ${tab.id} AND status = 'open' AND used_cents + ${amountCents} <= hold_cents
    RETURNING *`;
  if (!updated) {
    console.error(`Tab ${tab.id} had no room for a ${kind}.`);
    return false;
  }
  await sql`
    INSERT INTO tab_items (tab_id, search_key, amount_cents, kind)
    VALUES (${tab.id}, ${searchKey}, ${amountCents}, ${kind})`;
  if (updated.hold_cents - updated.used_cents < REANALYSIS_PRICE) await closeTab(updated, "full");
  return true;
}

// Is this search already on this tab? (A payment can be applied twice: by
// the return page and by the webhook.)
export async function searchOnTab(tabId, searchKey) {
  const [row] = await sql`
    SELECT 1 FROM tab_items WHERE tab_id = ${tabId} AND search_key = ${searchKey} AND kind = 'search'`;
  return Boolean(row);
}

// Charges what was used and releases the rest (or releases it all if nothing
// was used). Safe to call twice: only one caller gets to close a tab.
// `reason`: "full" (the next item didn't fit) or "time" (TAB_HOURS passed).
export async function closeTab(tab, reason = "time") {
  const [claimed] = await sql`
    UPDATE tabs SET status = 'closing', close_reason = ${reason}
    WHERE id = ${tab.id} AND status = 'open' RETURNING *`;
  if (!claimed) return;
  try {
    if (claimed.used_cents > 0) {
      await stripe.paymentIntents.capture(
        claimed.stripe_payment_intent,
        { amount_to_capture: claimed.used_cents },
        { idempotencyKey: `tab-capture-${claimed.id}` }
      );
      await sql`
        UPDATE tabs SET status = 'charged', charged_cents = ${claimed.used_cents}, closed_at = now()
        WHERE id = ${claimed.id}`;
    } else {
      await stripe.paymentIntents.cancel(claimed.stripe_payment_intent);
      await sql`UPDATE tabs SET status = 'released', charged_cents = 0, closed_at = now() WHERE id = ${claimed.id}`;
    }
  } catch (err) {
    // The hold expired or was released elsewhere. Logged for a manual look.
    console.error(`Closing tab ${claimed.id} failed:`, err.code || err.message);
    await sql`UPDATE tabs SET status = 'failed', closed_at = now() WHERE id = ${claimed.id}`;
  }
}

// Closes every tab past its time. Run daily (app/api/cron/close-tabs), and
// tabs are also closed whenever their user comes back.
export async function closeDueTabs() {
  await ensureTables();
  const due = await sql`
    SELECT * FROM tabs
    WHERE status = 'open' AND opened_at <= now() - make_interval(hours => ${TAB_HOURS})`;
  for (const tab of due) await closeTab(tab);
  return due.length;
}

// When a tab fills up it's charged, and the next re-analysis starts a new hold
// on the saved card without asking again (the user agreed to this when they
// started the first one). After this many holds in 24 hours, it asks again.
export const AUTO_RENEW_PER_DAY = 4;

// Should the next re-analysis start a new hold by itself? Yes when the user's
// last tab was charged because it filled up (in the last 24 hours) and they
// haven't hit the daily number of holds.
export async function canRenewTab(userId) {
  await ensureTables();
  const [row] = await sql`
    SELECT
      (SELECT status = 'charged' AND close_reason = 'full' AND closed_at > now() - interval '24 hours'
         FROM tabs WHERE user_id = ${userId} ORDER BY opened_at DESC LIMIT 1) AS last_filled,
      (SELECT count(*) FROM tabs WHERE user_id = ${userId} AND opened_at > now() - interval '24 hours') AS today`;
  return Boolean(row.last_filled) && Number(row.today) < AUTO_RENEW_PER_DAY;
}

// For the pages: { usedCents, holdCents, closesAt } for the open tab, or null.
export async function tabSummary(userId) {
  const tab = await getOpenTab(userId);
  return tab && { usedCents: tab.used_cents, holdCents: tab.hold_cents, closesAt: tabClosesAt(tab).toISOString() };
}

// Tabs that were charged, newest first, for the account page's history.
export async function chargedTabs(userId, limit = 5) {
  await ensureTables();
  return sql`
    SELECT id, charged_cents, closed_at FROM tabs
    WHERE user_id = ${userId} AND status = 'charged'
    ORDER BY closed_at DESC LIMIT ${limit}`;
}

export { TAB_HOLD };
