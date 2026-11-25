import { cleanSecret, saveSubscription, stripe } from "../../../lib/stripe";
import { completeCheckout } from "../../../lib/payments";

const webhookSecret = cleanSecret(process.env.STRIPE_WEBHOOK_SECRET);

// POST /api/stripe-webhook
// Stripe calls this when a subscription starts, changes, renews, or ends, so
// plans stay correct even when users manage billing in Stripe's portal.
export async function POST(request) {
  if (!stripe || !webhookSecret) {
    return Response.json({ error: "Webhook not configured." }, { status: 503 });
  }

  let event;
  try {
    // The signature check needs the exact raw body.
    event = stripe.webhooks.constructEvent(
      await request.text(),
      request.headers.get("stripe-signature"),
      webhookSecret
    );
  } catch (err) {
    console.error("Stripe webhook signature check failed:", err.message);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        // Re-read from Stripe so events arriving out of order can't save stale data.
        await saveSubscription(await stripe.subscriptions.retrieve(event.data.object.id));
        break;
      // A pay-per-search or re-analysis paid on Stripe Checkout.
      case "checkout.session.completed":
        if (event.data.object.mode === "payment") await completeCheckout(event.data.object.id);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook ${event.type} failed:`, err);
    return Response.json({ error: "Handler failed." }, { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true });
}
