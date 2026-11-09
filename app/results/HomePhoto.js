"use client";

import { useState } from "react";
import { MAPS_KEY } from "../maps/config";

// Street-level photo of a home's exterior from Google Street View.
// Listing photos themselves need licensed MLS access, so this is the stand-in.
// Requires "Street View Static API" to be enabled for the Maps key.
export default function HomePhoto({ lat, lng, alt, className }) {
  const [failed, setFailed] = useState(false);

  if (!MAPS_KEY || failed) {
    return (
      <div className={`home-photo home-photo-empty ${className || ""}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-5h4v5" />
        </svg>
      </div>
    );
  }

  const params = new URLSearchParams({
    size: "480x300",
    location: `${lat},${lng}`,
    fov: "80",
    source: "outdoor",
    // Makes Google return an error (instead of a grey placeholder) when there's
    // no imagery, so we can show our own fallback.
    return_error_code: "true",
    key: MAPS_KEY,
  });

  return (
    <img
      className={`home-photo ${className || ""}`}
      src={`https://maps.googleapis.com/maps/api/streetview?${params}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
