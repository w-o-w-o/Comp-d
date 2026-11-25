import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { commuteSearchKey, listCommutes, parseCheck, sameDestination, saveCommute } from "../../../lib/commutes";
import { commuteLimitFor, getPass } from "../../../lib/access";
import { demoAt } from "../../../lib/demo";
import { getUserPlan } from "../../../lib/plans";

// The demo's preset commute is shared by everyone, saved under this owner.
const DEMO_OWNER = "demo";

async function readSearch(lat, lng, mode) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  const demo = await demoAt(la, ln);
  return { lat: la, lng: ln, key: commuteSearchKey(la, ln, mode), demo };
}

// GET /api/commutes?lat=..&lng=..&mode=rent|buy -> { checks, limit, preset? }
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const s = await readSearch(p.get("lat"), p.get("lng"), p.get("mode"));
  if (!s) return Response.json({ error: "Invalid location." }, { status: 400 });
  if (s.demo) {
    const checks = sql ? await listCommutes(DEMO_OWNER, s.key) : [];
    return Response.json({ checks, limit: 0, preset: s.demo.commuteTo });
  }
  const access = await getUserPlan(userId);
  const limit = commuteLimitFor(access);
  if (!sql) return Response.json({ checks: [], limit });
  return Response.json({ checks: await listCommutes(userId, s.key), limit });
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
  const s = await readSearch(body.lat, body.lng, body.mode);
  const check = parseCheck(body.check);
  if (!s || !check) return Response.json({ error: "Invalid commute." }, { status: 400 });

  // Demo: only the preset destination, saved once for everyone.
  if (s.demo) {
    if (!sameDestination(check.destination, s.demo.commuteTo)) {
      return Response.json({ error: "The demo only includes its preset commute." }, { status: 403 });
    }
    const existing = await listCommutes(DEMO_OWNER, s.key);
    if (existing.some((c) => c.travelMode === check.travelMode)) return Response.json({ checks: existing, limit: 0 });
    const checks = await saveCommute(DEMO_OWNER, s.key, check, 4);
    return Response.json({ checks: checks || existing, limit: 0 });
  }

  const access = await getUserPlan(userId);
  if (!access.fullAccess && !(await getPass(userId, s.key))) {
    return Response.json({ error: "Unlock this search first." }, { status: 402 });
  }
  const limit = commuteLimitFor(access);
  const checks = await saveCommute(userId, s.key, check, limit);
  if (!checks) {
    return Response.json({ error: `This search already has ${limit} commute checks.`, limit }, { status: 429 });
  }
  return Response.json({ checks, limit });
}
