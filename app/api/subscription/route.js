import { auth } from "@clerk/nextjs/server";
import { getUserPlan } from "../../../lib/plans";
import { setPlanCanceling, stripe } from "../../../lib/stripe";

// POST /api/subscription { action: "cancel" | "resume" }
// Cancels the user's plan at the end of the paid period, or keeps it after all.
// The account page asks the user to confirm first.
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!stripe) return Response.json({ error: "Payments aren't set up on this server yet." }, { status: 503 });

  let action;
  try {
    ({ action } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (action !== "cancel" && action !== "resume") return Response.json({ error: "Invalid request." }, { status: 400 });

  const { tier, fullAccess } = await getUserPlan(userId);
  if (fullAccess || tier === "free") return Response.json({ error: "You don't have a plan to change." }, { status: 409 });

  try {
    const subscription = await setPlanCanceling(userId, action === "cancel");
    if (!subscription) return Response.json({ error: "You don't have a plan to change." }, { status: 409 });
    return Response.json({ ok: true, cancelAtPeriodEnd: subscription.cancel_at_period_end });
  } catch (err) {
    console.error("Changing the subscription failed:", err.code || err.message);
    return Response.json({ error: "Couldn't update your plan. Try again." }, { status: 502 });
  }
}
