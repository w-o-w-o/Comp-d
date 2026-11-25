import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { searchKeyFor } from "../../../lib/access";
import { analysesFor } from "../../../lib/analyses";

// GET /api/analyses?lat=..&lng=..&mode=rent|buy
// The user's own earlier AI analyses of this search, newest first:
// { analyses: [{ id, analysisKey, label, radiusMiles, createdAt, result }] }.
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ analyses: [] });

  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const mode = params.get("mode") === "buy" ? "buy" : "rent";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid location." }, { status: 400 });
  }
  try {
    const rows = await analysesFor(userId, searchKeyFor(lat, lng, mode));
    return Response.json({
      analyses: rows.map((r) => ({
        id: r.id,
        analysisKey: r.analysis_key,
        label: r.label,
        radiusMiles: r.radius_miles,
        createdAt: r.created_at,
        result: r.result,
      })),
    });
  } catch (err) {
    console.error("Loading past analyses failed:", err.message);
    return Response.json({ analyses: [] });
  }
}
