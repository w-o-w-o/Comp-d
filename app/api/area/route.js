import { auth } from "@clerk/nextjs/server";
import { sql } from "../../../lib/db";
import { amenitiesAround, amenitySummary, areaProfile } from "../../../lib/area";

// Public data lookups can take a few seconds on a cold cache.
export const maxDuration = 60;

// GET /api/area?lat=..&lng=..&radius=..&address=..&fallbackZip=..[&part=amenities]
// Facts about the searched property's area from free public sources. Nearby
// places (OpenStreetMap) are slower, so they come from a separate request
// with part=amenities.
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

  if (params.get("part") === "amenities") {
    const pois = await amenitiesAround({ lat, lng }, radiusMiles).catch((err) => {
      console.error("Area data (OpenStreetMap) failed:", err.message);
      return null;
    });
    return Response.json({ amenities: amenitySummary(pois, { lat, lng }) });
  }

  const { pois, ...profile } = await areaProfile({
    lat,
    lng,
    address,
    radiusMiles,
    listingZips: fallbackZip ? [fallbackZip] : [],
    includeAmenities: false,
  });
  return Response.json(profile);
}
