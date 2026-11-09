"use client";

import { useEffect, useState } from "react";
import {
  AdvancedMarker,
  Circle,
  ControlPosition,
  Map,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import SearchBar from "../search/SearchBar";
import {
  DEFAULT_RADIUS_MILES,
  MAP_ID,
  MAPS_KEY,
  MAX_RADIUS_MILES,
  METERS_PER_MILE,
  MIN_RADIUS_MILES,
  RADIUS_PRESETS_MILES,
} from "../maps/config";

const PRESETS_SORTED = [...RADIUS_PRESETS_MILES].sort((a, b) => a - b);

// Full-screen map of the searched property with a floating panel on top.
// The comparison area is a circle the user can resize by dragging its edge
// handles or by picking a preset distance.
export default function ResultsView({ address, placeId }) {
  const places = useMapsLibrary("places");
  const [lookup, setLookup] = useState({ status: "loading" });
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  // Bumped whenever the map should zoom to fit the whole circle.
  const [fitRequest, setFitRequest] = useState(0);

  useEffect(() => {
    if (!places) return;
    let cancelled = false;
    setLookup({ status: "loading" });

    (async () => {
      try {
        const fields = ["formattedAddress", "location"];
        let place;
        if (placeId) {
          place = new places.Place({ id: placeId });
          await place.fetchFields({ fields });
        } else {
          const { places: found } = await places.Place.searchByText({
            textQuery: address,
            fields,
            maxResultCount: 1,
          });
          place = found[0];
        }
        if (!place?.location) throw new Error("Address not found");
        if (cancelled) return;
        setLookup({
          status: "ready",
          position: place.location.toJSON(),
          formattedAddress: place.formattedAddress,
        });
        setFitRequest((n) => n + 1);
      } catch (err) {
        console.error("Map lookup failed:", err);
        if (!cancelled) setLookup({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [places, address, placeId]);

  function pickPreset(miles) {
    setRadiusMiles(miles);
    setFitRequest((n) => n + 1);
  }

  function handleDragResize(meters) {
    const miles = meters / METERS_PER_MILE;
    const clamped = Math.min(MAX_RADIUS_MILES, Math.max(MIN_RADIUS_MILES, miles));
    // Only update when it actually changed, so the controlled circle doesn't loop.
    setRadiusMiles((current) => (Math.abs(current - clamped) < 0.001 ? current : clamped));
  }

  const ready = lookup.status === "ready";

  return (
    <div className="results-full">
      <div className="results-map">
        {ready && (
          <Map
            mapId={MAP_ID}
            defaultCenter={lookup.position}
            defaultZoom={13}
            gestureHandling="greedy"
            colorScheme="FOLLOW_SYSTEM"
            streetViewControl={false}
            fullscreenControl={false}
            mapTypeControlOptions={{ position: ControlPosition.TOP_RIGHT }}
            style={{ width: "100%", height: "100%" }}
          >
            <AdvancedMarker position={lookup.position} title={lookup.formattedAddress}>
              <Pin background="#1f7a5a" borderColor="#145a42" glyphColor="#ffffff" />
            </AdvancedMarker>
            <Circle
              center={lookup.position}
              radius={radiusMiles * METERS_PER_MILE}
              editable
              onRadiusChanged={handleDragResize}
              strokeColor="#2fa77a"
              strokeOpacity={0.9}
              strokeWeight={2}
              fillColor="#2fa77a"
              fillOpacity={0.12}
            />
            <FitCircle
              center={lookup.position}
              radiusMeters={radiusMiles * METERS_PER_MILE}
              request={fitRequest}
            />
          </Map>
        )}
      </div>

      <aside className="results-panel">
        <SearchBar initialAddress={address} autoFocus={false} />

        <div className="panel-section">
          <p className="eyebrow">Comparing</p>
          <h1>{address}</h1>
          {ready && lookup.formattedAddress !== address && (
            <p className="panel-muted">{lookup.formattedAddress}</p>
          )}
          {!MAPS_KEY && (
            <p className="panel-muted">
              Add a Google Maps API key to show the property on a map.
            </p>
          )}
          {lookup.status === "error" && (
            <p className="panel-error">
              We couldn&apos;t find that address on the map. Try searching again and
              picking an address from the suggestions.
            </p>
          )}
        </div>

        {ready && (
          <div className="panel-section">
            <div className="radius-head">
              <h2>Search radius</h2>
              <span className="radius-value">{formatMiles(radiusMiles)}</span>
            </div>
            <div className="radius-presets" role="group" aria-label="Search radius presets">
              {PRESETS_SORTED.map((miles) => (
                <button
                  key={miles}
                  type="button"
                  className={Math.abs(radiusMiles - miles) < 0.001 ? "chip chip-active" : "chip"}
                  aria-pressed={Math.abs(radiusMiles - miles) < 0.001}
                  onClick={() => pickPreset(miles)}
                >
                  {formatMiles(miles)}
                </button>
              ))}
            </div>
            <p className="panel-muted">
              Or drag the white handles on the circle&apos;s edge to set your own.
            </p>
          </div>
        )}

        <div className="panel-section panel-upcoming">
          <p className="panel-muted">
            Verdict and comparable homes inside this area are coming soon.
          </p>
        </div>
      </aside>
    </div>
  );
}

// Zooms the map so the whole circle is visible, leaving room for the panel.
function FitCircle({ center, radiusMeters, request }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !request) return;
    const latDelta = radiusMeters / 111320;
    const lngDelta = radiusMeters / (111320 * Math.cos((center.lat * Math.PI) / 180));
    const bounds = {
      north: center.lat + latDelta,
      south: center.lat - latDelta,
      east: center.lng + lngDelta,
      west: center.lng - lngDelta,
    };
    const narrow = window.innerWidth < 760;
    map.fitBounds(
      bounds,
      narrow
        ? { top: 300, bottom: 24, left: 24, right: 24 }
        : { top: 48, bottom: 48, left: 460, right: 48 }
    );
    // Only refit when asked (new address or preset), not while dragging.
  }, [map, request]);

  return null;
}

function formatMiles(miles) {
  return `${Math.round(miles * 10) / 10} mi`;
}
