import { auth } from "@clerk/nextjs/server";
import { getUserPlan } from "../../../lib/plans";
import { stripe } from "../../../lib/stripe";

// GET /api/billing-portal
// Opens Stripe's billing portal, where users change or cancel their plan,
// update their card, and see invoices.
export async function GET(request) {
  const origin = request.nextUrl.origin;
  const { userId } = await auth();
  if (!userId) {
    return Response.redirect(`${origin}/sign-in?redirect_url=/api/billing-portal`, 303);
  }
  if (!stripe) return Response.redirect(`${origin}/account?billing=unavailable`, 303);

  const { subscription } = await getUserPlan(userId);
  if (!subscription?.stripe_customer_id) return Response.redirect(`${origin}/#pricing`, 303);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/account`,
    });
    return Response.redirect(session.url, 303);
  } catch (err) {
    console.error("Stripe billing portal failed:", err);
    return Response.redirect(`${origin}/account?billing=error`, 303);
  }
}
