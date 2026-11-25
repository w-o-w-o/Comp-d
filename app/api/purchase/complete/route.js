import { auth } from "@clerk/nextjs/server";
import { completeCheckout } from "../../../../lib/payments";
import { stripe } from "../../../../lib/stripe";

// GET /api/purchase/complete?session_id=..&return=/results?...
// Stripe sends the user here after paying. The payment is applied right away
// (the webhook does the same, whichever comes first), then the user goes back
// to the search they were on.
export async function GET(request) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const back = params.get("return") || "/search";
  const returnTo = back.startsWith("/") && !back.startsWith("//") ? back : "/search";

  const { userId } = await auth();
  if (!userId || !stripe) return Response.redirect(`${origin}${returnTo}`, 303);
  try {
    await completeCheckout(params.get("session_id") || "", userId);
  } catch (err) {
    console.error("Completing a payment failed:", err.message);
  }
  const sep = returnTo.includes("?") ? "&" : "?";
  return Response.redirect(`${origin}${returnTo}${sep}paid=1`, 303);
}
