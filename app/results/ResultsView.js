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
import useComparables from "./useComparables";
import { formatFacts, formatMiles, formatPrice, formatShortPrice } from "./format";
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
// handles or by picking a preset distance. Active listings inside it are shown
// as price pins and listed in the panel.
export default function ResultsView({ address, placeId }) {
  const places = useMapsLibrary("places");
  const [lookup, setLookup] = useState({ status: "loading" });
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [mode, setMode] = useState("rent");
  const [selectedId, setSelectedId] = useState(null);
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

  const ready = lookup.status === "ready";
  const comps = useComparables({
    position: ready ? lookup.position : null,
    address: ready ? lookup.formattedAddress : null,
    mode,
    radiusMiles,
  });
  const selected = comps.nearby.find((l) => l.id === selectedId) || null;

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

  function pickMode(next) {
    setMode(next);
    setSelectedId(null);
  }

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
            clickableIcons={false}
            mapTypeControlOptions={{ position: ControlPosition.TOP_RIGHT }}
            onClick={() => setSelectedId(null)}
            style={{ width: "100%", height: "100%" }}
          >
            <Circle
              center={lookup.position}
              radius={radiusMiles * METERS_PER_MILE}
              editable
              clickable={false}
              onRadiusChanged={handleDragResize}
              strokeColor="#2fa77a"
              strokeOpacity={0.9}
              strokeWeight={2}
              fillColor="#2fa77a"
              fillOpacity={0.12}
            />

            {comps.nearby.map((l) => (
              <AdvancedMarker
                key={l.id}
                position={l}
                title={`${l.address} — ${formatPrice(l.price, mode)}`}
                zIndex={l.id === selectedId ? 1000 : undefined}
                onClick={() => setSelectedId(l.id)}
              >
                <div className={l.id === selectedId ? "price-pin price-pin-selected" : "price-pin"}>
                  {formatShortPrice(l.price)}
                </div>
              </AdvancedMarker>
            ))}

            <AdvancedMarker position={lookup.position} title={lookup.formattedAddress} zIndex={2000}>
              <Pin background="#1f7a5a" borderColor="#145a42" glyphColor="#ffffff" />
            </AdvancedMarker>

            <FitCircle
              center={lookup.position}
              radiusMeters={radiusMiles * METERS_PER_MILE}
              request={fitRequest}
            />
            <PanToListing listing={selected} />
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
          <>
            <div className="panel-section">
              <div className="mode-toggle" role="group" aria-label="Looking to rent or buy">
                <button
                  type="button"
                  className={mode === "rent" ? "chip chip-active" : "chip"}
                  aria-pressed={mode === "rent"}
                  onClick={() => pickMode("rent")}
                >
                  Renting
                </button>
                <button
                  type="button"
                  className={mode === "buy" ? "chip chip-active" : "chip"}
                  aria-pressed={mode === "buy"}
                  onClick={() => pickMode("buy")}
                >
                  Buying
                </button>
              </div>
              <Estimate comps={comps} mode={mode} />
            </div>

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

            <Listings
              comps={comps}
              mode={mode}
              radiusMiles={radiusMiles}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </>
        )}
      </aside>
    </div>
  );
}

function Estimate({ comps, mode }) {
  if (comps.status === "loading" || comps.status === "idle") {
    return <p className="panel-muted">Loading property data…</p>;
  }
  if (comps.status === "error") {
    return <p className="panel-error">{comps.message}</p>;
  }
  const estimate = comps.data.estimate;
  if (!estimate?.amount) {
    return (
      <p className="panel-muted">
        No {mode === "rent" ? "rent" : "value"} estimate is available for this address.
      </p>
    );
  }
  const facts = formatFacts(estimate.subject);
  return (
    <div className="estimate">
      <p className="estimate-label">
        Estimated {mode === "rent" ? "rent" : "value"} for this property
      </p>
      <p className="estimate-amount">{formatPrice(estimate.amount, mode)}</p>
      {estimate.low && estimate.high && (
        <p className="panel-muted">
          Likely range {formatPrice(estimate.low, mode)} – {formatPrice(estimate.high, mode)}
        </p>
      )}
      {facts && <p className="panel-muted">{facts}</p>}
    </div>
  );
}

function Listings({ comps, mode, radiusMiles, selectedId, onSelect }) {
  if (comps.status !== "ready") return null;
  const label = mode === "rent" ? "for rent" : "for sale";

  return (
    <div className="panel-section">
      <h2>
        {comps.nearby.length} {comps.nearby.length === 1 ? "home" : "homes"} {label} within{" "}
        {formatMiles(radiusMiles)}
      </h2>
      {comps.nearby.length === 0 ? (
        <p className="panel-muted">Try a larger radius to see more listings.</p>
      ) : (
        <ul className="listing-list">
          {comps.nearby.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={l.id === selectedId ? "listing listing-selected" : "listing"}
                onClick={() => onSelect(l.id)}
              >
                <span className="listing-price">{formatPrice(l.price, mode)}</span>
                <span className="listing-address">{l.address}</span>
                <span className="listing-facts">
                  {[formatFacts(l), formatMiles(l.distance) + " away"].filter(Boolean).join(" · ")}
                </span>
                {l.id === selectedId && (
                  <span className="listing-extra">
                    {[
                      l.type,
                      l.yearBuilt && `Built ${l.yearBuilt}`,
                      l.daysOnMarket != null && `${l.daysOnMarket} days listed`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="panel-credit">Listing data from RentCast</p>
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

// Keeps the selected listing in view.
function PanToListing({ listing }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !listing) return;
    const bounds = map.getBounds();
    if (!bounds?.contains(listing)) map.panTo(listing);
  }, [map, listing]);

  return null;
}
