import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Nav from "../Nav";
import { formatCents, getUserPlan, REANALYSIS_PRICE, SEARCH_PRICE } from "../../lib/plans";
import { planSearchesUsed } from "../../lib/access";
import { savedCard } from "../../lib/payments";
import { ensureTables, sql } from "../../lib/db";

const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };
const shortDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

async function recentPurchases(userId) {
  if (!sql) return [];
  await ensureTables();
  return sql`
    SELECT id, kind, amount_cents, created_at FROM purchases
    WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 5`;
}

export const metadata = { title: "My account — Comp'd" };

const BILLING_MESSAGES = {
  error: "Something went wrong with billing. Please try again.",
  unavailable: "Payments aren't set up on this server yet.",
};

const longDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function AccountPage({ searchParams }) {
  // Sends logged-out visitors to the log-in page, then back here afterwards.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");
  const { billing } = await searchParams;
  const { tier, plan, subscription, fullAccess } = await getUserPlan(userId);
  const planSearches = tier !== "free" && !fullAccess ? await planSearchesUsed(userId, tier) : null;
  const [card, purchases] = await Promise.all([
    subscription?.stripe_customer_id ? savedCard(subscription.stripe_customer_id).catch(() => null) : null,
    recentPurchases(userId),
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
            {planSearches != null && (
              <p>
                {planSearches} of {plan.searchesPer30Days} searches used in the last 30 days
                {tier === "advanced" ? " (fair-use limit)" : ""}. After that, searches are{" "}
                {formatCents(SEARCH_PRICE)} each.
              </p>
            )}
            <div className="plan-actions">
              {!fullAccess && tier === "free" && (
                <>
                  <a href="/api/checkout?plan=basic" className="btn">
                    Basic — $10/mo (6 searches)
                  </a>
                  <a href="/api/checkout?plan=advanced" className="btn btn-ghost">
                    Unlimited — $25/mo
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
              {subscription?.stripe_customer_id && (
                <a href="/api/billing-portal" className="btn btn-ghost">
                  {card ? "Update or remove card" : "Manage billing"}
                </a>
              )}
              {purchases.length > 0 && (
                <ul className="purchase-list">
                  {purchases.map((p) => (
                    <li key={p.id}>
                      <span>{p.kind === "search" ? "Search" : "AI re-analysis"}</span>
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
