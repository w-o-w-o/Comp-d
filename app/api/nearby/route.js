import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { getSavedNearby, parseNearby, saveNearby } from "../../../lib/nearby";
import { demoAt } from "../../../lib/demo";

// This week's demo address shares one set of counts across all visitors.
const DEMO_OWNER = "demo";
const ownerFor = async (userId, p) => ((await demoAt(p.lat, p.lng)) ? DEMO_OWNER : userId);

function point(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
    ? { lat: la, lng: ln }
    : null;
}

// GET /api/nearby?lat=..&lng=..  -> { data } (saved counts, or null)
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ data: null });

  const params = request.nextUrl.searchParams;
  const p = point(params.get("lat"), params.get("lng"));
  if (!p) return Response.json({ error: "Invalid location." }, { status: 400 });
  return Response.json({ data: await getSavedNearby(await ownerFor(userId, p), p.lat, p.lng) });
}

// POST /api/nearby { lat, lng, data } -> saves counts the browser looked up.
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ saved: false });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const p = point(body.lat, body.lng);
  const data = parseNearby(body.data);
  if (!p || !data) return Response.json({ error: "Invalid nearby data." }, { status: 400 });
  const owner = await ownerFor(userId, p);
  // The demo's shared counts are saved once, by the first visitor of the week.
  if (owner === DEMO_OWNER && (await getSavedNearby(owner, p.lat, p.lng))) return Response.json({ saved: false });
  await saveNearby(owner, p.lat, p.lng, data);
  return Response.json({ saved: true });
}
