"use client";

// Fields used to place a searched address on the map. Address, location and
// types are Google's cheapest "Essentials" tier.
export const PLACE_FIELDS = ["formattedAddress", "location", "types"];

// Google place types that mean one specific home or building.
const HOME_TYPES = ["street_address", "premise", "subpremise", "establishment", "point_of_interest"];

// Is this place an area (a ZIP code, city, neighborhood, county, street…)
// rather than one home? Comp'd judges a specific home against its
// surroundings, so an area can't be searched. Unknown types count as a home.
export function isArea(types) {
  return Array.isArray(types) && types.length > 0 && !types.some((t) => HOME_TYPES.includes(t));
}

const KEY = (placeId) => `compd-place|${placeId}`;

// Saves a looked-up place for this browser tab, so the results page can use it
// instead of paying for the same lookup again.
export function rememberPlace(place) {
  if (!place?.id || !place.location) return;
  try {
    window.sessionStorage.setItem(
      KEY(place.id),
      JSON.stringify({
        position: place.location.toJSON(),
        formattedAddress: place.formattedAddress,
        types: place.types || [],
      })
    );
  } catch {}
}

// { position, formattedAddress, types } saved by rememberPlace, or null.
export function recallPlace(placeId) {
  if (!placeId) return null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY(placeId)));
    const { lat, lng } = saved?.position || {};
    return Number.isFinite(lat) && Number.isFinite(lng) && saved.formattedAddress ? saved : null;
  } catch {
    return null;
  }
}
