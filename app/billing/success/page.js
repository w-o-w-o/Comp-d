import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../../Nav";
import { PLANS } from "../../../lib/plans";
import { saveSubscription, stripe } from "../../../lib/stripe";

export const metadata = { title: "Welcome — Comp'd" };

// Stripe sends the user here after paying. The subscription is saved right
// away so the plan works immediately, even before the webhook arrives.
export default async function BillingSuccessPage({ searchParams }) {
  const { session_id: sessionId } = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");
  if (!stripe || !sessionId) redirect("/account");

  let tier = null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    // Only the person who paid can claim this checkout.
    if (session.client_reference_id === userId && session.subscription) {
      await saveSubscription(session.subscription);
      tier = session.subscription.metadata?.tier;
    }
  } catch (err) {
    console.error("Couldn't confirm checkout:", err);
  }

  return (
    <>
      <Nav />
      <main className="wrap account">
        <p className="eyebrow">Billing</p>
        {tier && PLANS[tier] ? (
          <>
            <h1>You&apos;re on {PLANS[tier].name}!</h1>
            <p className="lede">Thanks for subscribing. Your new features are ready.</p>
          </>
        ) : (
          <>
            <h1>Payment received</h1>
            <p className="lede">
              We&apos;re still confirming your subscription. It should show on your account
              page within a minute.
            </p>
          </>
        )}
        <div className="account-actions">
          <Link href="/search" className="btn">
            Start a search
          </Link>
          <Link href="/account" className="btn btn-ghost">
            My account
          </Link>
        </div>
      </main>
    </>
  );
}
