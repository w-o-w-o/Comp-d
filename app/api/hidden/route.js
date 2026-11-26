import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { hiddenListings, hideListing, unhideListing } from "../../../lib/hidden";

const modeOf = (m) => (m === "buy" ? "buy" : "rent");
const listingIdOf = (v) => String(v || "").trim().slice(0, 300);

// GET /api/hidden?mode=rent|buy -> { hidden: [{ listingId, address, reason, createdAt }] }
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ hidden: [] });
  return Response.json({ hidden: await hiddenListings(userId, modeOf(request.nextUrl.searchParams.get("mode"))) });
}

// POST /api/hidden { listingId, mode, address, reason } -> hides it ("not for me")
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ error: "Not available on this server." }, { status: 503 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const listingId = listingIdOf(body.listingId);
  const address = String(body.address || "").slice(0, 300);
  if (!listingId || !address) return Response.json({ error: "Invalid request." }, { status: 400 });
  await hideListing(userId, { listingId, mode: modeOf(body.mode), address, reason: body.reason });
  return Response.json({ ok: true });
}

// DELETE /api/hidden?listingId=..&mode=rent|buy -> shows it again
export async function DELETE(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ error: "Not available on this server." }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const listingId = listingIdOf(params.get("listingId"));
  if (!listingId) return Response.json({ error: "Invalid request." }, { status: 400 });
  await unhideListing(userId, listingId, modeOf(params.get("mode")));
  return Response.json({ ok: true });
}
