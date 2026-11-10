import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Nav from "../Nav";
import { getUserPlan, searchesLeft } from "../../lib/plans";

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
  const freeSearchesLeft = await searchesLeft(userId, plan);
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
            {freeSearchesLeft != null && (
              <p>
                You have {freeSearchesLeft} of {plan.searchesPer30Days} free searches left
                (each search counts for 30 days). AI recommendations come with Basic and
                Advanced.
              </p>
            )}
            <div className="plan-actions">
              {!fullAccess && tier === "free" && (
                <>
                  <a href="/api/checkout?plan=basic" className="btn">
                    Upgrade to Basic — $10/mo
                  </a>
                  <a href="/api/checkout?plan=advanced" className="btn btn-ghost">
                    Advanced — $20/mo
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
