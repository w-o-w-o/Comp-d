import { auth, currentUser } from "@clerk/nextjs/server";
import { getUserPlan } from "../../../lib/plans";
import { customerIdFor, isPaidTier, priceIdFor, stripe } from "../../../lib/stripe";

// GET /api/checkout?plan=basic|advanced
// Sends the user to Stripe Checkout for that plan.
export async function GET(request) {
  const origin = request.nextUrl.origin;
  const tier = request.nextUrl.searchParams.get("plan");

  const { userId } = await auth();
  if (!userId) {
    const back = `/api/checkout?plan=${encodeURIComponent(tier || "")}`;
    return Response.redirect(`${origin}/sign-in?redirect_url=${encodeURIComponent(back)}`, 303);
  }
  if (!isPaidTier(tier)) return Response.redirect(`${origin}/#pricing`, 303);
  if (!stripe) return Response.redirect(`${origin}/account?billing=unavailable`, 303);

  // Already subscribed (or full access): plan changes and cancelling happen in
  // the Stripe billing portal instead of a second checkout.
  const current = await getUserPlan(userId);
  if (current.fullAccess) return Response.redirect(`${origin}/account`, 303);
  if (current.tier !== "free") return Response.redirect(`${origin}/api/billing-portal`, 303);

  try {
    const user = await currentUser();
    const customer = await customerIdFor(userId, user?.primaryEmailAddress?.emailAddress);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: userId,
      line_items: [{ price: await priceIdFor(tier), quantity: 1 }],
      subscription_data: { metadata: { tier, userId } },
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#pricing`,
    });
    return Response.redirect(session.url, 303);
  } catch (err) {
    console.error("Stripe checkout failed:", err);
    return Response.redirect(`${origin}/account?billing=error`, 303);
  }
}
