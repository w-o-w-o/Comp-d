"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { MAPS_KEY } from "./config";

// Loads Google Maps for everything inside it. Without a key the children still
// render; the search bar then works as a plain text box and the map is hidden.
export default function MapsProvider({ children }) {
  if (!MAPS_KEY) return children;
  return <APIProvider apiKey={MAPS_KEY}>{children}</APIProvider>;
}
