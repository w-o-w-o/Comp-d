import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Nav from "../Nav";
import PlanCancel from "./PlanCancel";
import { CREDIT_COST, formatCents, getUserPlan, PLANS, REANALYSIS_PRICE, SEARCH_PRICE, TAB_HOLD } from "../../lib/plans";
import { planUsage } from "../../lib/access";
import { savedCard } from "../../lib/payments";
import { ensureTables, sql } from "../../lib/db";
import { chargedTabs, tabSummary } from "../../lib/tabs";
import { recentAnalyses } from "../../lib/analyses";

const RATING_LABELS = {
  "good deal": "Good deal",
  fair: "Fairly priced",
  overpriced: "Overpriced",
  "not enough data": "Not enough data",
};
// "619 W College Ave, State College, PA 16801" -> "619 W College Ave, State College"
const shortAddress = (a) => a.split(",").slice(0, 2).join(",");

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

const PURCHASE_LABELS = { search: "Search", reanalysis: "AI re-analysis", tab: "Tab (searches and re-analyses)" };

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
  const [card, purchases, tab, analyses] = await Promise.all([
    subscription?.stripe_customer_id ? savedCard(subscription.stripe_customer_id).catch(() => null) : null,
    recentPurchases(userId),
    fullAccess ? null : tabSummary(userId),
    sql ? recentAnalyses(userId).catch(() => []) : [],
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
                Re-analyses are +{formatCents(REANALYSIS_PRICE)}. Both go on a $5 hold that&apos;s charged once for
                what you use.
              </p>
            )}
            {usage && (
              <>
                <ul className="usage-list">
                  <UsageRow label="Credits" count={usage.credits} />
                </ul>
                <p className="panel-muted">
                  A search uses {CREDIT_COST.search} credits and includes its first AI analysis; each re-analysis
                  uses {CREDIT_COST.reanalysis} (or your last one).{" "}
                  Counted over the last 30 days: each one frees up 30 days after you use it. Reopening a search
                  or analysis you&apos;ve already run is free. Past your plan, searches are{" "}
                  {formatCents(SEARCH_PRICE)} and re-analyses {formatCents(REANALYSIS_PRICE)}, on a{" "}
                  {formatCents(TAB_HOLD)} hold.
                </p>
              </>
            )}
            <div className="plan-actions">
              {!fullAccess && tier === "free" && (
                <>
                  <a href="/api/checkout?plan=basic" className="btn">
                    {PLANS.basic.name} — ${PLANS.basic.price / 100}/mo ({PLANS.basic.creditsPer30Days} credits)
                  </a>
                  <a href="/api/checkout?plan=advanced" className="btn btn-ghost">
                    {PLANS.advanced.name} — ${PLANS.advanced.price / 100}/mo ({PLANS.advanced.creditsPer30Days} credits)
                  </a>
                </>
              )}
              {!fullAccess && tier !== "free" && (
                <>
                  <a href="/api/billing-portal" className="btn btn-ghost">
                    Change plan or manage billing
                  </a>
                  <PlanCancel
                    planName={plan.name}
                    endsOn={subscription?.current_period_end ? longDate(subscription.current_period_end) : null}
                    canceling={Boolean(subscription?.cancel_at_period_end)}
                  />
                </>
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
                  <strong>Open tab: {formatCents(tab.usedCents)}</strong> of searches and re-analyses so far. We&apos;re holding{" "}
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
            <h3>Your AI analyses</h3>
            {analyses.length === 0 ? (
              <p>
                You haven&apos;t run an AI analysis yet. The ones you run will show up here to look back on.
              </p>
            ) : (
              <ul className="past-list">
                {analyses.map((a) => (
                  <li key={a.id}>
                    <details className="past-analysis">
                      <summary>
                        <span className={`past-rating past-${a.result.verdict.rating.replace(/\s+/g, "-")}`}>
                          {RATING_LABELS[a.result.verdict.rating]}
                        </span>
                        <span className="past-label">{shortAddress(a.address)}</span>
                        <span className="past-open" aria-hidden="true">
                          ▸
                        </span>
                        <span className="past-meta">
                          {a.mode === "buy" ? "Buying" : "Renting"} · {a.label} · {shortDate(a.created_at)}
                        </span>
                      </summary>
                      <div className="past-body">
                        <p>{a.result.verdict.summary}</p>
                        {a.result.recommendations.length > 0 && (
                          <ul>
                            {a.result.recommendations.map((r) => (
                              <li key={r.listingId}>{r.headline}</li>
                            ))}
                          </ul>
                        )}
                        {!a.demo && (
                          <Link
                            href={`/results?${new URLSearchParams({
                              address: a.address,
                              radius: String(a.radius_miles),
                              mode: a.mode,
                              from: "history",
                            })}`}
                          >
                            Open this search →
                          </Link>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
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
