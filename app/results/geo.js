// Distance helpers shared by the browser and the server.

// Listings are fetched for a fixed area and filtered by the user's exact radius,
// so small radius changes don't cost new RentCast requests.
export const FETCH_RADII_MILES = [5, 10, 25];

// Smallest fetch area (miles) that covers the chosen radius.
export function fetchRadiusFor(radiusMiles) {
  return FETCH_RADII_MILES.find((r) => radiusMiles <= r) ?? FETCH_RADII_MILES.at(-1);
}

export function distanceMiles(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
