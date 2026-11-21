import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { deleteSearch, saveSearch } from "../../../lib/history";

// POST /api/history — saves (or refreshes) a search the user just viewed.
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ error: "History isn't set up." }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusMiles = Number(body.radiusMiles);
  const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const number = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null);
  const address = text(body.address, 200);

  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid search." }, { status: 400 });
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 25) {
    return Response.json({ error: "Invalid radius." }, { status: 400 });
  }

  await saveSearch(userId, {
    address,
    formattedAddress: text(body.formattedAddress, 200),
    placeId: text(body.placeId, 300),
    lat,
    lng,
    mode: body.mode === "buy" ? "buy" : "rent",
    radiusMiles: Math.round(radiusMiles * 100) / 100,
    estimateAmount: number(body.estimateAmount),
    listingCount: Number.isInteger(body.listingCount) ? body.listingCount : null,
  });
  return Response.json({ saved: true });
}

// DELETE /api/history?id=123 — removes one of the user's saved searches.
export async function DELETE(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ error: "History isn't set up." }, { status: 503 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "Invalid id." }, { status: 400 });

  await deleteSearch(userId, id);
  return Response.json({ deleted: true });
}
