import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Nav from "../Nav";
import { formatCents, getUserPlan, PLANS, REANALYSIS_PRICE, SEARCH_PRICE } from "../../lib/plans";
import { planUsage } from "../../lib/access";
import { savedCard } from "../../lib/payments";
import { ensureTables, sql } from "../../lib/db";
import { chargedTabs, tabSummary } from "../../lib/tabs";

const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };
const shortDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Searches, older one-off re-analyses, and charged re-analysis tabs, newest first.
async function recentPurchases(userId) {
  if (!sql) return [];
  await ensureTables();
  const [bought, tabs] = await Promise.all([
    sql`
      SELECT id, kind, amount_cents, created_at FROM purchases
      WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 5`,
    chargedTabs(userId),
  ]);
  return [
    ...bought,
    ...tabs.map((t) => ({ id: `tab-${t.id}`, kind: "tab", amount_cents: t.charged_cents, created_at: t.closed_at })),
  ]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
}

const PURCHASE_LABELS = { search: "Search", reanalysis: "AI re-analysis", tab: "AI re-analyses (tab)" };

export const metadata = { title: "My account — Comp'd" };

// "Searches: 12 of 30 left" with a bar, plus when the next one frees up.
function UsageRow({ label, count }) {
  const left = Math.max(0, count.max - count.used);
  return (
    <li>
      <span>
        {label}: <strong>{left} of {count.max} left</strong>
        {count.nextFree && left < count.max && (
          <span className="panel-muted"> · next frees up {shortDate(count.nextFree)}</span>
        )}
      </span>
      <span className="usage-bar" aria-hidden="true">
        <span style={{ width: `${Math.round((100 * left) / count.max)}%` }} />
      </span>
    </li>
  );
}

const BILLING_MESSAGES = {
  error: "Something went wrong with billing. Please try again.",
  unavailable: "Payments aren't set up on this server yet.",
};

const longDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
// When a tab closes, as "in about 5 hours" (the server doesn't know the
// visitor's time zone, so no clock time).
function closesIn(d) {
  const hours = Math.max(1, Math.round((new Date(d).getTime() - Date.now()) / 3_600_000));
  return `in about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export default async function AccountPage({ searchParams }) {
  // Sends logged-out visitors to the log-in page, then back here afterwards.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");
  const { billing } = await searchParams;
  const access = await getUserPlan(userId);
  const { tier, plan, subscription, fullAccess } = access;
  const usage = await planUsage(userId, access);
  const [card, purchases, tab] = await Promise.all([
    subscription?.stripe_customer_id ? savedCard(subscription.stripe_customer_id).catch(() => null) : null,
    recentPurchases(userId),
    fullAccess ? null : tabSummary(userId),
  ]);
  const user = await currentUser();
  const email = user.primaryEmailAddress?.emailAddress;
  const name = user.firstName || email;
  const joined = longDate(user.createdAt);

  return (
    <>
      <Nav />
      <main className="wrap account">
        <p className="eyebrow">My account</p>
        <h1>Welcome, {name}!</h1>
        <p className="lede">You&apos;re logged in to Comp&apos;d.</p>
        {BILLING_MESSAGES[billing] && <p className="panel-error">{BILLING_MESSAGES[billing]}</p>}

        <div className="account-grid">
          <div className="card plan-card">
            <h3>Your plan</h3>
            <p className="plan-name">
              {plan.name}
              {fullAccess && <span className="ai-badge">Full access</span>}
            </p>
            {fullAccess && <p>This account has every feature unlocked.</p>}
            {!fullAccess && subscription?.current_period_end && tier !== "free" && (
              <p>
                {subscription.cancel_at_period_end ? "Ends" : "Renews"} on{" "}
                {longDate(subscription.current_period_end)}
                {subscription.status === "past_due" && " — payment past due, please update your card"}
              </p>
            )}
            {!fullAccess && tier === "free" && (
              <p>
                Each search is {formatCents(SEARCH_PRICE)} and includes 1 AI analysis and 3 commute checks.
                Extra analyses are {formatCents(REANALYSIS_PRICE)}.
              </p>
            )}
            {usage && (
              <>
                <ul className="usage-list">
                  <UsageRow label="Searches" count={usage.searches} />
                  {usage.ai && <UsageRow label="AI analyses" count={usage.ai} />}
                </ul>
                <p className="panel-muted">
                  Counted over the last 30 days: each one frees up 30 days after you use it. Reopening a search
                  or analysis you&apos;ve already run is free. Past your plan, searches are{" "}
                  {formatCents(SEARCH_PRICE)} and analyses {formatCents(REANALYSIS_PRICE)}.
                </p>
              </>
            )}
            <div className="plan-actions">
              {!fullAccess && tier === "free" && (
                <>
                  <a href="/api/checkout?plan=basic" className="btn">
                    {PLANS.basic.name} — ${PLANS.basic.price / 100}/mo ({PLANS.basic.searchesPer30Days} searches)
                  </a>
                  <a href="/api/checkout?plan=advanced" className="btn btn-ghost">
                    {PLANS.advanced.name} — ${PLANS.advanced.price / 100}/mo ({PLANS.advanced.searchesPer30Days}{" "}
                    searches)
                  </a>
                </>
              )}
              {!fullAccess && tier !== "free" && (
                <a href="/api/billing-portal" className="btn btn-ghost">
                  Change plan or manage billing
                </a>
              )}
            </div>
          </div>

          {!fullAccess && (
            <div className="card">
              <h3>Payment</h3>
              {card ? (
                <p>
                  Card on file: <strong>{BRANDS[card.brand] || card.brand} •••• {card.last4}</strong>, saved securely
                  with Stripe. You confirm every charge before it&apos;s made.
                </p>
              ) : (
                <p>No card saved yet. Your first payment saves one with Stripe for one-click searches.</p>
              )}
              {tab && (
                <p className="tab-note">
                  <strong>Open tab: {formatCents(tab.usedCents)}</strong> of AI re-analyses so far. We&apos;re holding{" "}
                  {formatCents(tab.holdCents)} on your card and will charge only the {formatCents(tab.usedCents)} {closesIn(tab.closesAt)} (or sooner if the tab fills
                  up); the rest is released.
                </p>
              )}
              <p className="panel-muted">
                Questions about a charge? See our <Link href="/refunds">refund policy</Link>.
              </p>
              {subscription?.stripe_customer_id && (
                <a href="/api/billing-portal" className="btn btn-ghost">
                  {card ? "Update or remove card" : "Manage billing"}
                </a>
              )}
              {purchases.length > 0 && (
                <ul className="purchase-list">
                  {purchases.map((p) => (
                    <li key={p.id}>
                      <span>{PURCHASE_LABELS[p.kind] || "Purchase"}</span>
                      <span>{formatCents(p.amount_cents)}</span>
                      <span className="panel-muted">{shortDate(p.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="card">
            <h3>Your details</h3>
            <dl className="details">
              <dt>Email</dt>
              <dd>{email}</dd>
              <dt>Member since</dt>
              <dd>{joined}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Saved comparisons</h3>
            <p>
              You haven&apos;t compared any homes yet. Comparisons you run will
              show up here.
            </p>
          </div>
        </div>

        <div className="account-actions">
          <Link href="/search" className="btn">
            Start a search
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
          <SignOutButton>
            <button className="btn btn-ghost">Log out</button>
          </SignOutButton>
        </div>
      </main>
    </>
  );
}
