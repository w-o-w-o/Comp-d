import { auth } from "@clerk/nextjs/server";
import { BudgetError } from "../../../lib/rentcast";
import { demoSubject } from "../../../lib/demo";

// GET /api/demo?mode=rent|buy -> this week's demo home
// { address, lat, lng, center, commuteTo, week, endsAt }.
// Signed-in users only (the demo needs an account).
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  const mode = request.nextUrl.searchParams.get("mode") === "buy" ? "buy" : "rent";
  try {
    return Response.json(await demoSubject(mode));
  } catch (err) {
    if (err instanceof BudgetError) return Response.json({ error: err.message }, { status: 429 });
    console.error("Demo lookup failed:", err);
    return Response.json({ error: "Couldn't load the demo. Try again later." }, { status: 502 });
  }
}
