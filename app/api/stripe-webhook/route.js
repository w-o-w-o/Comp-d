import { saveSubscription, stripe } from "../../../lib/stripe";

// POST /api/stripe-webhook
// Stripe calls this when a subscription starts, changes, renews, or ends, so
// plans stay correct even when users manage billing in Stripe's portal.
export async function POST(request) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Webhook not configured." }, { status: 503 });
  }

  let event;
  try {
    // The signature check needs the exact raw body.
    event = stripe.webhooks.constructEvent(
      await request.text(),
      request.headers.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET
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
      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook ${event.type} failed:`, err);
    return Response.json({ error: "Handler failed." }, { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true });
}
