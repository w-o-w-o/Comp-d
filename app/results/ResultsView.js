"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import HomePhoto from "./HomePhoto";
import useComparables from "./useComparables";
import AiRecommendation, { UpgradeButton, useAiCollapsed, useRecommendation } from "./AiRecommendation";
import AreaInsights, { useArea } from "./AreaInsights";
import CommuteBox, { formatCommute, useCommute } from "./Commute";
import { useNearbyPlaces } from "./NearbyPlaces";
import { usePriorities } from "./AiPreferences";
import { animateCamera, cameraForCircle } from "./camera";
import {
  BED_OPTIONS,
  defaultFilters,
  matchesFilters,
  medianPricePerSqft,
  pricePerSqft,
  TYPE_GROUPS,
  typeGroup,
} from "./quality";
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
// Searches reopened from history skip straight to "results" with their saved
// radius and rent/buy choice. Every search that reaches "results" is saved.
export default function ResultsView({ address, placeId, initialRadius, initialMode, fromHistory }) {
  const places = useMapsLibrary("places");
  const [lookup, setLookup] = useState({ status: "loading" });
  const [stage, setStage] = useState(fromHistory ? "results" : "arriving");
  const [radiusMiles, setRadiusMiles] = useState(initialRadius ?? DEFAULT_RADIUS_MILES);
  const [mode, setMode] = useState(initialMode ?? "rent");
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
  // "Similar homes" filters: defaults come from the subject home until the
  // user picks their own.
  const [chosenFilters, setFilters] = useState(null);
  const subjectFacts = comps.status === "ready" ? comps.data.estimate?.subject : null;
  const filters = useMemo(
    () => chosenFilters ?? (comps.status === "ready" ? defaultFilters(subjectFacts) : null),
    [chosenFilters, comps.status, subjectFacts]
  );
  const shown = useMemo(
    () => comps.nearby.filter((l) => matchesFilters(l, filters)),
    [comps.nearby, filters]
  );

  const selected = comps.nearby.find((l) => l.id === selectedId) || null;
  const resultsPosition = ready && stage === "results" ? lookup.position : null;
  const commute = useCommute({ subject: resultsPosition, listings: shown });
  const commuteForAi =
    commute.status === "ready"
      ? {
          destination: commute.destination,
          travelMode: commute.travelMode,
          subjectMinutes: commute.subjectMinutes,
          byListing: commute.byListing,
        }
      : null;
  const nearby = useNearbyPlaces(resultsPosition);
  const priorities = usePriorities(mode);
  const wide = useIsWide();
  const [aiCollapsed, setAiCollapsed] = useAiCollapsed();
  const ai = useRecommendation({
    position: resultsPosition,
    address: ready ? lookup.formattedAddress : null,
    mode,
    radiusMiles,
    commute: commuteForAi,
    nearby: nearby.status === "ready" ? nearby.data : null,
    filters,
    priorities: priorities.payload,
  });
  const area = useArea({
    // Wait for the listings, so their ZIP code fallback is known and the
    // area is looked up once.
    position: comps.status === "ready" ? resultsPosition : null,
    address: ready ? lookup.formattedAddress : null,
    radiusMiles,
    fallbackZip: mostCommonZip(comps.nearby),
  });
  // globalThis.Map: the built-in Map, since `Map` here is the Google map component.
  const listingsById = new globalThis.Map(comps.nearby.map((l) => [l.id, l]));

  // Save the search to history once its homes load, and again (after a pause)
  // when the radius or rent/buy choice changes.
  const nearbyCount = comps.nearby.length;
  const estimateAmount = comps.status === "ready" ? comps.data.estimate?.amount ?? null : null;
  useEffect(() => {
    if (!ready || stage !== "results" || comps.status !== "ready") return;
    const timer = setTimeout(() => {
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          formattedAddress: lookup.formattedAddress,
          placeId: placeId || null,
          lat: lookup.position.lat,
          lng: lookup.position.lng,
          mode,
          radiusMiles,
          estimateAmount,
          listingCount: nearbyCount,
        }),
      }).catch((err) => console.error("Couldn't save search:", err));
    }, 1000);
    return () => clearTimeout(timer);
  }, [ready, stage, comps.status, address, placeId, lookup, mode, radiusMiles, estimateAmount, nearbyCount]);

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
  const aiSection = (
    <AiRecommendation
      ai={ai}
      listingsById={listingsById}
      mode={mode}
      onSelect={setSelectedId}
      canRun={comps.status === "ready" && shown.length > 0}
      priorities={priorities}
      prefsCtx={{ estimate: estimateAmount, radiusMiles }}
      collapsed={aiCollapsed}
      onCollapse={setAiCollapsed}
    />
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
            defaultZoom={fromHistory ? 13 : 4}
            gestureHandling="greedy"
            colorScheme="FOLLOW_SYSTEM"
            streetViewControl={false}
            fullscreenControl={false}
            clickableIcons={false}
            mapTypeControlOptions={{ position: ControlPosition.TOP_CENTER }}
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
              shown.map((l) => (
                <AdvancedMarker
                  key={l.id}
                  position={l}
                  title={`${l.address} — ${formatPrice(l.price, mode)}`}
                  zIndex={l.id === selectedId ? 1000 : undefined}
                  onClick={() => setSelectedId(l.id)}
                >
                  <div
                    className={[
                      "price-pin",
                      ai.picks.includes(l.id) && "price-pin-ai",
                      l.id === selectedId && "price-pin-selected",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {ai.picks.includes(l.id) && "★ "}
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
                <ListingCard listing={selected} mode={mode} commute={commute} compact />
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
          <Link href="/search">← Back to search</Link>
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
          {/* Back instead of a search bar: re-searching the same address
              would repeat lookups for no benefit. */}
          <Link href="/search" className="back-link">
            ← Back to search
          </Link>

          <div className="panel-section">
            <p className="eyebrow">Comparing</p>
            <h1>{lookup.formattedAddress}</h1>
            <div className="panel-row">{modeControls}</div>
            <Estimate comps={comps} mode={mode} />
          </div>

          {/* Narrower screens have no room for a second panel, so the AI
              goes right under the address instead. */}
          {!wide && aiSection}

          <AreaInsights
            area={area}
            nearby={nearby}
            mode={mode}
            subjectBeds={comps.status === "ready" ? comps.data.estimate?.subject?.beds : null}
          />

          <CommuteBox commute={commute} />

          <div className="panel-section">{radiusControls}</div>

          <Listings
            comps={comps}
            shown={shown}
            filters={filters}
            onFilters={setFilters}
            mode={mode}
            radiusMiles={radiusMiles}
            selectedId={selectedId}
            onSelect={setSelectedId}
            commute={commute}
          />
        </aside>
      )}

      {ready && stage === "results" && wide && (
        <aside className={aiCollapsed ? "ai-panel ai-panel-collapsed" : "ai-panel"} aria-label="AI recommendation">
          {aiSection}
        </aside>
      )}
    </div>
  );
}

// Wide enough for the AI to get its own panel on the right.
// (Below 1200px both panels get slimmer; see globals.css.)
export const WIDE_QUERY = "(min-width: 900px)";
function useIsWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
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
    return (
      <>
        <p className="panel-error">{comps.message}</p>
        {comps.upgradeTo && <UpgradeButton tier={comps.upgradeTo} />}
      </>
    );
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

function Listings({ comps, shown, filters, onFilters, mode, radiusMiles, selectedId, onSelect, commute }) {
  if (comps.status !== "ready") return null;
  const label = mode === "rent" ? "for rent" : "for sale";
  const total = comps.nearby.length;
  const filtered = shown.length !== total;

  return (
    <div className="panel-section">
      <h2>
        {filtered ? `${shown.length} of ${total}` : total} {total === 1 ? "home" : "homes"} {label}{" "}
        within {formatMiles(radiusMiles)}
      </h2>
      <p className="panel-muted listing-freshness">
        Listing data from {formatDataDate(comps.data.listingsFetchedAt)}. Some homes may already be taken.
      </p>
      {mode === "buy" && <PricePerSqftSummary shown={shown} estimate={comps.data.estimate} />}
      {total > 0 && (
        <ListingFilters
          filters={filters}
          onChange={onFilters}
          showLand={comps.nearby.some((l) => typeGroup(l.type) === "land") || filters.types.includes("land")}
        />
      )}
      {total === 0 ? (
        <p className="panel-muted">Try a larger radius to see more listings.</p>
      ) : shown.length === 0 ? (
        <p className="panel-muted">No homes match these filters. Try more bedroom counts or home types.</p>
      ) : (
        <ul className="listing-list">
          {shown.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={l.id === selectedId ? "listing listing-selected" : "listing"}
                onClick={() => onSelect(l.id)}
              >
                <ListingCard listing={l} mode={mode} commute={commute} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="panel-credit">Listing data from RentCast · Photos from Google Street View</p>
    </div>
  );
}

// Bedroom and home-type chips. Several can be on at once; none means "any".
function ListingFilters({ filters, onChange, showLand }) {
  const toggle = (key, value) => {
    const list = filters[key];
    onChange({
      ...filters,
      [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort(),
    });
  };
  const chip = (active, label, onClick) => (
    <button
      key={label}
      type="button"
      className={active ? "chip chip-active" : "chip"}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="listing-filters">
      <div className="filter-row" role="group" aria-label="Bedrooms">
        <span className="filter-label">Beds</span>
        {chip(filters.beds.length === 0, "Any", () => onChange({ ...filters, beds: [] }))}
        {BED_OPTIONS.map((b) =>
          chip(filters.beds.includes(b), b === 0 ? "Studio" : b === 4 ? "4+" : String(b), () =>
            toggle("beds", b)
          )
        )}
      </div>
      <div className="filter-row" role="group" aria-label="Home type">
        <span className="filter-label">Type</span>
        {chip(filters.types.length === 0, "Any", () => onChange({ ...filters, types: [] }))}
        {Object.entries(TYPE_GROUPS)
          .filter(([group]) => group !== "land" || showLand)
          .map(([group, { label }]) => chip(filters.types.includes(group), label, () => toggle("types", group)))}
      </div>
    </div>
  );
}

// Typical price per square foot of the homes shown, and where the subject's
// estimate falls against it.
function PricePerSqftSummary({ shown, estimate }) {
  const typical = medianPricePerSqft(shown);
  if (!typical) return null;
  const subject = estimate?.amount && estimate.subject?.sqft ? Math.round(estimate.amount / estimate.subject.sqft) : null;
  const diff = subject ? Math.round(((subject - typical.median) / typical.median) * 100) : null;
  return (
    <p className="ppsf-summary">
      Median <strong>${typical.median.toLocaleString()}/sq ft</strong> across {typical.count} homes
      {subject != null && (
        <>
          {" · "}this property&apos;s estimate: ${subject.toLocaleString()}/sq ft
          {diff !== 0 && ` (${Math.abs(diff)}% ${diff > 0 ? "above" : "below"})`}
        </>
      )}
    </p>
  );
}

function formatDataDate(iso) {
  if (!iso) return "recently";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  const date = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return days <= 0 ? `today (${date})` : `${date} (${days} ${days === 1 ? "day" : "days"} ago)`;
}

function formatMonth(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function mostCommonZip(listings) {
  const counts = {};
  for (const l of listings) if (l.zip) counts[l.zip] = (counts[l.zip] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Photo card used in the panel list and in the map popup.
function ListingCard({ listing: l, mode, commute, compact = false }) {
  const commuteText =
    commute?.status === "ready"
      ? formatCommute(commute.byListing[l.id], commute.travelMode, commute.milesByListing?.[l.id])
      : null;
  const details = [
    l.type,
    l.yearBuilt && `Built ${l.yearBuilt}`,
    l.daysListed != null && `${l.daysListed} ${l.daysListed === 1 ? "day" : "days"} listed`,
  ].filter(Boolean);

  // Warnings and extra facts, shown on every card.
  const notes = [];
  if (l.possiblyPerRoom) {
    notes.push({ warn: true, text: "Price may be per room", title: "Cheaper than a typical studio or 1-bedroom nearby, so this is likely the price of one room, not the whole home." });
  }
  if (l.priceCut) {
    notes.push({ good: true, text: `Reduced ${formatPrice(l.priceCut, mode)}`, title: `Listed at ${formatPrice(l.previousPrice, mode)} in ${formatMonth(l.previousListedDate)}` });
  } else if (l.previousPrice && l.previousPrice !== l.price) {
    notes.push({ text: `Was ${formatPrice(l.previousPrice, mode)} in ${formatMonth(l.previousListedDate)}`, title: "Price the last time this home was listed" });
  }
  if (l.hoaFee) notes.push({ text: `HOA ${formatPrice(l.hoaFee, "rent")}` });
  if (!l.sqft && typeGroup(l.type) !== "land") notes.push({ text: "Size not listed" });

  return (
    <div className={compact ? "home-card home-card-compact" : "home-card"}>
      <HomePhoto lat={l.lat} lng={l.lng} alt={`Street view of ${l.address}`} />
      <div className="home-card-body">
        <span className="listing-price">
          {formatPrice(l.price, mode)}
          {mode === "buy" && pricePerSqft(l) && (
            <span className="listing-ppsf">${pricePerSqft(l).toLocaleString()}/sq ft</span>
          )}
        </span>
        <span className="listing-facts">
          {[formatFacts(l), `${formatMiles(l.distance)} away`].filter(Boolean).join(" · ")}
        </span>
        <span className="listing-address">{l.address}</span>
        {notes.length > 0 && (
          <span className="listing-notes">
            {notes.map((n) => (
              <span
                key={n.text}
                title={n.title}
                className={n.warn ? "listing-note listing-note-warn" : n.good ? "listing-note listing-note-good" : "listing-note"}
              >
                {n.text}
              </span>
            ))}
          </span>
        )}
        {commuteText && <span className="listing-commute">{commuteText}</span>}
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
            {/* Only for MLS listings: those are fed to Zillow, so Zillow's
                address lookup lands on the home's own page. Others (most
                rentals) often have no Zillow page, and Zillow would show a
                different home instead. */}
            {l.onMls && (
              <a
                className="home-card-link"
                href={`https://www.zillow.com/homes/${encodeURIComponent(l.address)}_rb/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Zillow ↗
              </a>
            )}
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
  if (narrow) return { top: window.innerHeight * 0.45, bottom: 16, left: 16, right: 16 };
  // Room for the panels (slimmer below 1200px), including the AI panel on
  // the right when it's shown.
  const panel = window.innerWidth < 1200 ? 356 : 416;
  const right = window.matchMedia(WIDE_QUERY).matches ? panel + 24 : 40;
  return { top: 40, bottom: 40, left: panel + 24, right };
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
