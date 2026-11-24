"use client";

// Fields used to place a searched address on the map. Address and location are
// Google's cheapest "Essentials" tier.
export const PLACE_FIELDS = ["formattedAddress", "location"];

const KEY = (placeId) => `compd-place|${placeId}`;

// Saves a looked-up place for this browser tab, so the results page can use it
// instead of paying for the same lookup again.
export function rememberPlace(place) {
  if (!place?.id || !place.location) return;
  try {
    window.sessionStorage.setItem(
      KEY(place.id),
      JSON.stringify({ position: place.location.toJSON(), formattedAddress: place.formattedAddress })
    );
  } catch {}
}

// { position, formattedAddress } saved by rememberPlace, or null.
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
