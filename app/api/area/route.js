import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { areaProfile } from "../../../lib/area";

// Public data lookups can take a few seconds on a cold cache.
export const maxDuration = 60;

// GET /api/area?lat=..&lng=..&radius=..&address=..&fallbackZip=..
// Facts about the searched property's area from free public sources. (Nearby
// places come from Google Places in the browser.)
export async function GET(request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!sql) return Response.json({ error: "Area data isn't set up." }, { status: 503 });

  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const radiusMiles = Number(params.get("radius"));
  const address = (params.get("address") || "").slice(0, 200);
  const fallbackZip = /^\d{5}$/.test(params.get("fallbackZip") || "") ? params.get("fallbackZip") : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid location." }, { status: 400 });
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 25) {
    return Response.json({ error: "Invalid radius." }, { status: 400 });
  }

  const profile = await areaProfile({
    lat,
    lng,
    address,
    listingZips: fallbackZip ? [fallbackZip] : [],
  });
  return Response.json(profile);
}
