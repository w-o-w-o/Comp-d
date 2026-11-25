import { cleanSecret, saveSubscription, stripe } from "../../../lib/stripe";
import { completeCheckout } from "../../../lib/payments";

// Signing secrets of the webhook destinations that may call this route.
// COMPD_STRIPE_WEBHOOK_SECRET is our own; STRIPE_WEBHOOK_SECRET may be set by
// Vercel's Stripe integration for its own destination. Either one is accepted.
const webhookSecrets = [process.env.COMPD_STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET]
  .map(cleanSecret)
  .filter(Boolean);

// POST /api/stripe-webhook
// Stripe calls this when a subscription starts, changes, renews, or ends, so
// plans stay correct even when users manage billing in Stripe's portal.
export async function POST(request) {
  if (!stripe || webhookSecrets.length === 0) {
    return Response.json({ error: "Webhook not configured." }, { status: 503 });
  }

  // The signature check needs the exact raw body.
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  let event;
  for (const secret of webhookSecrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // Try the next secret.
    }
  }
  if (!event) {
    console.error("Stripe webhook signature check failed for every configured secret.");
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
