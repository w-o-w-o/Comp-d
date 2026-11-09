export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Map style. Create one in Google Cloud Console → Google Maps Platform →
// Map Management, then set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID. Without it,
// Google's default look (DEMO_MAP_ID) is used.
export const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export const METERS_PER_MILE = 1609.34;

// Radius choices shown as buttons, in miles. The first one is the default.
export const RADIUS_PRESETS_MILES = [1, 0.5, 2, 5];
export const DEFAULT_RADIUS_MILES = RADIUS_PRESETS_MILES[0];

// Limits when resizing the circle by dragging, in miles.
export const MIN_RADIUS_MILES = 0.1;
export const MAX_RADIUS_MILES = 25;
