"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AdvancedMarker,
  Circle,
  ControlPosition,
  InfoWindow,
  Map,
  Pin,
  RenderingType,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import SearchBar from "../search/SearchBar";
import HomePhoto from "./HomePhoto";
import useComparables from "./useComparables";
import { animateCamera, cameraForCircle } from "./camera";
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

// Results flow, in stages:
//   "arriving" — the map zooms in from far away to the property's pin
//   "radius"   — the user picks a search radius (presets or dragging) and rent/buy
//   "results"  — estimate and nearby listings load, as price pins and photo cards
export default function ResultsView({ address, placeId }) {
  const places = useMapsLibrary("places");
  const [lookup, setLookup] = useState({ status: "loading" });
  const [stage, setStage] = useState("arriving");
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [mode, setMode] = useState("rent");
  const [selectedId, setSelectedId] = useState(null);
  // Bumped whenever the camera should re-frame the circle (preset picked).
  const [frameRequest, setFrameRequest] = useState(0);

  useEffect(() => {
    if (!places) return;
    let cancelled = false;

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
        if (!cancelled) {
          setLookup({
            status: "ready",
            position: place.location.toJSON(),
            formattedAddress: place.formattedAddress,
          });
        }
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
    // Nothing is fetched (or billed) until the user confirms a radius.
    position: ready && stage === "results" ? lookup.position : null,
    address: ready ? lookup.formattedAddress : null,
    mode,
    radiusMiles,
  });
  const selected = comps.nearby.find((l) => l.id === selectedId) || null;

  function pickPreset(miles) {
    setRadiusMiles(miles);
    setFrameRequest((n) => n + 1);
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

  const radiusControls = (
    <RadiusControls radiusMiles={radiusMiles} onPreset={pickPreset} />
  );
  const modeControls = <ModeToggle mode={mode} onChange={pickMode} />;

  return (
    <div className="results-full">
      <div className="results-map">
        {ready && (
          <Map
            mapId={MAP_ID}
            renderingType={RenderingType.VECTOR}
            defaultCenter={lookup.position}
            defaultZoom={4}
            gestureHandling="greedy"
            colorScheme="FOLLOW_SYSTEM"
            streetViewControl={false}
            fullscreenControl={false}
            clickableIcons={false}
            mapTypeControlOptions={{ position: ControlPosition.TOP_RIGHT }}
            onClick={() => setSelectedId(null)}
            style={{ width: "100%", height: "100%" }}
          >
            {stage !== "arriving" && (
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
            )}

            {stage === "results" &&
              comps.nearby.map((l) => (
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

            {selected && (
              <InfoWindow
                position={selected}
                pixelOffset={[0, -28]}
                headerDisabled
                onCloseClick={() => setSelectedId(null)}
              >
                <ListingCard listing={selected} mode={mode} compact />
              </InfoWindow>
            )}

            <AdvancedMarker position={lookup.position} title={lookup.formattedAddress} zIndex={2000}>
              <Pin background="#1f7a5a" borderColor="#145a42" glyphColor="#ffffff" />
            </AdvancedMarker>

            <CameraDirector
              stage={stage}
              position={lookup.position}
              radiusMeters={radiusMiles * METERS_PER_MILE}
              frameRequest={frameRequest}
              onArrived={() => setStage("radius")}
            />
            <PanToListing listing={selected} />
          </Map>
        )}
      </div>

      {stage !== "results" && (
        <div className="flow-chip">
          <span className="flow-chip-address">{ready ? lookup.formattedAddress : address}</span>
          <Link href="/search">New search</Link>
        </div>
      )}

      {(!MAPS_KEY || lookup.status === "error") && (
        <div className="flow-card">
          <h2>{MAPS_KEY ? "We couldn't find that address" : "Maps isn't set up"}</h2>
          <p className="panel-muted">
            {MAPS_KEY
              ? "Try searching again and picking an address from the suggestions."
              : "Add a Google Maps API key to show the property on a map."}
          </p>
          <Link href="/search" className="btn">
            New search
          </Link>
        </div>
      )}

      {ready && stage === "radius" && (
        <div className="flow-card" role="dialog" aria-labelledby="radius-title">
          <h2 id="radius-title">Choose your radius</h2>
          <p className="panel-muted">
            Drag the white handles on the circle, or pick a distance.
          </p>
          {radiusControls}
          <div className="flow-card-row">
            <span className="flow-card-label">I&apos;m looking to</span>
            {modeControls}
          </div>
          <button type="button" className="btn flow-card-go" onClick={() => setStage("results")}>
            Show homes
          </button>
        </div>
      )}

      {ready && stage === "results" && (
        <aside className="results-panel">
          <SearchBar initialAddress={address} autoFocus={false} />

          <div className="panel-section">
            <p className="eyebrow">Comparing</p>
            <h1>{lookup.formattedAddress}</h1>
            <div className="panel-row">{modeControls}</div>
            <Estimate comps={comps} mode={mode} />
          </div>

          <div className="panel-section">{radiusControls}</div>

          <Listings
            comps={comps}
            mode={mode}
            radiusMiles={radiusMiles}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Looking to rent or buy">
      {[
        ["rent", "Rent"],
        ["buy", "Buy"],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={mode === value ? "chip chip-active" : "chip"}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RadiusControls({ radiusMiles, onPreset }) {
  return (
    <>
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
            onClick={() => onPreset(miles)}
          >
            {formatMiles(miles)}
          </button>
        ))}
      </div>
    </>
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
                <ListingCard listing={l} mode={mode} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="panel-credit">Listing data from RentCast · Photos from Google Street View</p>
    </div>
  );
}

// Photo card used in the panel list and in the map popup.
function ListingCard({ listing: l, mode, compact = false }) {
  const details = [
    l.type,
    l.yearBuilt && `Built ${l.yearBuilt}`,
    l.daysOnMarket != null && `${l.daysOnMarket} days listed`,
  ].filter(Boolean);

  return (
    <div className={compact ? "home-card home-card-compact" : "home-card"}>
      <HomePhoto lat={l.lat} lng={l.lng} alt={`Street view of ${l.address}`} />
      <div className="home-card-body">
        <span className="listing-price">{formatPrice(l.price, mode)}</span>
        <span className="listing-facts">
          {[formatFacts(l), `${formatMiles(l.distance)} away`].filter(Boolean).join(" · ")}
        </span>
        <span className="listing-address">{l.address}</span>
        {compact && details.length > 0 && (
          <span className="listing-facts">{details.join(" · ")}</span>
        )}
        {compact && (
          <div className="home-card-links">
            {/* Not every listing is on Zillow; Google finds it on whichever
                site has it (Apartments.com, Redfin, the property's own site...). */}
            <a
              className="home-card-link"
              href={`https://www.google.com/search?q=${encodeURIComponent(
                `${l.address} ${mode === "rent" ? "for rent" : "for sale"}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Find this listing ↗
            </a>
            <a
              className="home-card-link"
              href={`https://www.zillow.com/homes/${encodeURIComponent(l.address)}_rb/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Zillow ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// Space (in pixels) covered by floating UI at each stage, so the circle is
// framed in the visible part of the map.
function insetFor(stage) {
  const narrow = window.innerWidth < 760;
  if (stage === "radius") {
    return narrow
      ? { top: 64, bottom: 330, left: 16, right: 16 }
      : { top: 72, bottom: 290, left: 40, right: 40 };
  }
  return narrow
    ? { top: window.innerHeight * 0.45, bottom: 16, left: 16, right: 16 }
    : { top: 40, bottom: 40, left: 450, right: 40 };
}

// Drives the camera: the zoom-in on arrival, then framing the circle whenever
// the stage changes or a preset radius is picked.
function CameraDirector({ stage, position, radiusMeters, frameRequest, onArrived }) {
  const map = useMap();
  const radiusRef = useRef(radiusMeters);
  radiusRef.current = radiusMeters;
  const onArrivedRef = useRef(onArrived);
  onArrivedRef.current = onArrived;

  useEffect(() => {
    if (!map) return;
    if (stage === "arriving") {
      // Short pause so the starting view registers before the zoom.
      let cancel = () => {};
      const timer = setTimeout(() => {
        cancel = animateCamera(map, { center: position, zoom: 16 }, 2400, () =>
          setTimeout(() => onArrivedRef.current(), 350)
        );
      }, 400);
      return () => {
        clearTimeout(timer);
        cancel();
      };
    }
    const target = cameraForCircle(map, position, radiusRef.current, insetFor(stage));
    return animateCamera(map, target, 900);
    // Re-frame on stage changes and preset picks, not on every drag update.
  }, [map, stage, position, frameRequest]);

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
