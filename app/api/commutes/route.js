import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { COMMUTE_LIMIT, commuteSearchKey, listCommutes, parseCheck, saveCommute } from "../../../lib/commutes";

function searchKeyFrom(lat, lng, mode) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return commuteSearchKey(la, ln, mode);
}

// GET /api/commutes?lat=..&lng=..&mode=rent|buy -> { checks, limit }
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ checks: [], limit: COMMUTE_LIMIT });

  const p = request.nextUrl.searchParams;
  const key = searchKeyFrom(p.get("lat"), p.get("lng"), p.get("mode"));
  if (!key) return Response.json({ error: "Invalid location." }, { status: 400 });
  return Response.json({ checks: await listCommutes(userId, key), limit: COMMUTE_LIMIT });
}

// POST /api/commutes { lat, lng, mode, check } -> { checks, limit }, or 429 at the limit.
export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ error: "Commute saving isn't set up." }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const key = searchKeyFrom(body.lat, body.lng, body.mode);
  const check = parseCheck(body.check);
  if (!key || !check) return Response.json({ error: "Invalid commute." }, { status: 400 });

  const checks = await saveCommute(userId, key, check);
  if (!checks) {
    return Response.json(
      { error: `This search already has ${COMMUTE_LIMIT} commute checks.`, limit: COMMUTE_LIMIT },
      { status: 429 }
    );
  }
  return Response.json({ checks, limit: COMMUTE_LIMIT });
}
