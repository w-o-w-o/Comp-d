import { auth, currentUser } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { getPass, searchKeyFor } from "../../../lib/access";
import { getUserPlan, REANALYSIS_PRICE } from "../../../lib/plans";
import { getOpenTab } from "../../../lib/tabs";
import { chargeSavedCard, checkoutFor, payForSearch, PRODUCTS, savedCard } from "../../../lib/payments";
import { stripe } from "../../../lib/stripe";

function readSearch(o) {
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const mode = o.mode === "buy" ? "buy" : "rent";
  return { lat, lng, mode, key: searchKeyFor(lat, lng, mode) };
}

// Only paths on this site may be returned to after paying.
function safeReturn(path) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path.slice(0, 1500) : "/search";
}

async function customerId(userId) {
  const [row] = await sql`SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}`;
  return row?.stripe_customer_id || null;
}

// GET /api/purchase -> { card: { brand, last4 } | null, prices }
// What the page needs to show a pay button ("Pay $2.50 with Visa •••• 4242").
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  const prices = { search: PRODUCTS.search.price, reanalysis: PRODUCTS.reanalysis.price, tabHold: PRODUCTS.tab.price };
  if (!stripe || !sql) return Response.json({ card: null, prices, available: false });
  try {
    const card = await savedCard(await customerId(userId));
    return Response.json({ card: card && { brand: card.brand, last4: card.last4 }, prices, available: true });
  } catch (err) {
    console.error("Couldn't read the saved card:", err.message);
    return Response.json({ card: null, prices, available: true });
  }
}

// POST /api/purchase { kind: "search"|"tab", lat, lng, mode, label, returnTo, useSavedCard }
// ("tab" puts a hold on the card for re-analyses; "reanalysis" is the older one-off charge.)
// -> { ok: true } when paid with the saved card, or { checkoutUrl } to pay on Stripe.
// The page only calls this after the user confirmed the amount.
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!stripe || !sql) return Response.json({ error: "Payments aren't set up on this server yet." }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const kind = body.kind;
  const search = readSearch(body);
  if (!["search", "tab", "reanalysis"].includes(kind) || !search) {
    return Response.json({ error: "Invalid purchase." }, { status: 400 });
  }
  const label = String(body.label || "").replace(/\s+/g, " ").slice(0, 150) || "Search";
  const returnTo = safeReturn(body.returnTo);

  const access = await getUserPlan(userId);
  if (access.fullAccess) return Response.json({ ok: true });
  // Don't charge for a search that's already open.
  if (kind === "search" && (await getPass(userId, search.key))) return Response.json({ ok: true });
  // Re-analyses need the search itself to be open.
  if ((kind === "reanalysis" || kind === "tab") && !(await getPass(userId, search.key))) {
    return Response.json({ error: "Unlock this search first." }, { status: 409 });
  }
  // Don't hold the card again while a tab with room is open.
  if (kind === "tab") {
    const tab = await getOpenTab(userId);
    if (tab && tab.hold_cents - tab.used_cents >= REANALYSIS_PRICE) return Response.json({ ok: true });
  }

  try {
    // Searches go on the user's tab (a $5 hold, charged later for what's used).
    if (kind === "search") {
      const user = await currentUser();
      const result = await payForSearch({
        userId,
        email: user?.primaryEmailAddress?.emailAddress,
        searchKey: search.key,
        label,
        useSavedCard: Boolean(body.useSavedCard),
        origin: request.nextUrl.origin,
        returnTo,
      });
      return Response.json(result);
    }
    const cust = await customerId(userId);
    const card = body.useSavedCard ? await savedCard(cust) : null;
    if (card) {
      const result = await chargeSavedCard({ userId, customerId: cust, card, kind, searchKey: search.key, label });
      if (result.ok) return Response.json({ ok: true });
      // The bank wants confirmation, or the card failed: pay on Stripe instead.
    }
    const user = await currentUser();
    const checkoutUrl = await checkoutFor({
      userId,
      email: user?.primaryEmailAddress?.emailAddress,
      kind,
      searchKey: search.key,
      label,
      origin: request.nextUrl.origin,
      returnTo,
    });
    return Response.json({ checkoutUrl, savedCardFailed: Boolean(card) });
  } catch (err) {
    console.error("Purchase failed:", err);
    return Response.json({ error: "Couldn't start the payment. Try again." }, { status: 502 });
  }
}
