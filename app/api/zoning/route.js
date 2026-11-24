import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { BudgetError, rentcastCached, rentcastGetDated } from "../../../lib/rentcast";

// Zoning rarely changes, so a looked-up record is kept for 90 days.
const ZONING_CACHE_DAYS = 90;
const PATH = "/properties";

// GET /api/zoning?address=..          -> the saved record, if any (free)
// GET /api/zoning?address=..&fetch=1  -> looks it up (one RentCast request)
// The county's property record for the address: zoning code and lot size.
// No free source covers zoning nationwide, so this only runs when the user asks.
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql || !process.env.RENTCAST_API_KEY) {
    return Response.json({ error: "Property data isn't set up on this server yet." }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const address = (params.get("address") || "").replace(/,\s*USA$/, "").slice(0, 200);
  if (!address) return Response.json({ error: "Missing address." }, { status: 400 });

  try {
    const hit =
      params.get("fetch") === "1"
        ? await rentcastGetDated(PATH, { address }, userId, ZONING_CACHE_DAYS)
        : await rentcastCached(PATH, { address }, ZONING_CACHE_DAYS);
    if (!hit) return Response.json({ status: "not-looked-up" });

    const record = Array.isArray(hit.data) ? hit.data[0] : hit.data;
    return Response.json({
      status: "ready",
      zoning: record?.zoning || null,
      lotSize: record?.lotSize ?? null,
      propertyType: record?.propertyType ?? null,
      county: record?.county ?? null,
      fetchedAt: hit.fetchedAt,
    });
  } catch (err) {
    if (err instanceof BudgetError) return Response.json({ error: err.message }, { status: 429 });
    console.error("Zoning lookup failed:", err);
    return Response.json({ error: "Couldn't look up zoning. Try again later." }, { status: 502 });
  }
}
