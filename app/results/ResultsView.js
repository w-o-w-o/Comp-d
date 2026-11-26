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
import { isArea, PLACE_FIELDS, recallPlace, rememberPlace } from "../maps/placeLookup";
import useComparables from "./useComparables";
import AiRecommendation, { useAiCollapsed, useRecommendation } from "./AiRecommendation";
import { SearchPaywall } from "./Payment";
import PlanUsage from "./PlanUsage";
import AreaInsights, { useArea } from "./AreaInsights";
import CommuteBox, { formatCommute, useCommute } from "./Commute";
import { useNearbyPlaces } from "./NearbyPlaces";
import AiPreferences, { usePriorities } from "./AiPreferences";
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
//   "arriving"   — the map zooms in from far away to the property's pin
//   "radius"     — the user picks a search radius (presets or dragging) and rent/buy
//   "priorities" — what matters to them (the AI panel's priorities), optional
//   "results"    — estimate and nearby listings load, as price pins and photo
//                  cards, then the first AI analysis runs with those priorities
// Searches reopened from history skip straight to "results" with their saved
// radius and rent/buy choice. Every search that reaches "results" is saved.
export default function ResultsView({ address, placeId, initialRadius, initialMode, fromHistory, demo = false }) {
  const places = useMapsLibrary("places");
  const [lookup, setLookup] = useState({ status: "loading" });
  const [stage, setStage] = useState(fromHistory ? "results" : "arriving");
  const [radiusMiles, setRadiusMiles] = useState(initialRadius ?? DEFAULT_RADIUS_MILES);
  const [mode, setMode] = useState(initialMode ?? "rent");
  const [selectedId, setSelectedId] = useState(null);
  // Bumped whenever the camera should re-frame the circle (preset picked).
  const [frameRequest, setFrameRequest] = useState(0);

  useEffect(() => {
    // The demo's home comes from Comp'd (it changes weekly, and differs for
    // renting and buying), not a lookup.
    if (demo) {
      let cancelled = false;
      fetch(`/api/demo?mode=${mode}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`demo ${r.status}`))))
        .then((d) => {
          if (!cancelled) {
            setLookup({ status: "ready", position: { lat: d.lat, lng: d.lng }, formattedAddress: d.address, demoInfo: d });
          }
        })
        .catch((err) => {
          console.error("Demo lookup failed:", err);
          if (!cancelled) setLookup({ status: "error" });
        });
      return () => {
        cancelled = true;
      };
    }
    if (!places) return;
    let cancelled = false;

    (async () => {
      try {
        // Already looked up when the address was picked from the suggestions.
        const remembered = recallPlace(placeId);
        if (remembered) {
          if (!cancelled) setLookup({ status: "ready", ...remembered });
          return;
        }
        const fields = PLACE_FIELDS;
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
        if (placeId) rememberPlace(place);
        if (!cancelled) {
          setLookup({
            status: "ready",
            position: place.location.toJSON(),
            formattedAddress: place.formattedAddress,
            types: place.types || [],
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
    // mode only matters for the demo (its home differs for renting and buying).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, address, placeId, demo, demo && mode]);

  // A ZIP code, city or neighborhood instead of one home: nothing is looked up
  // or charged; the page asks for a street address instead.
  const areaSearch = lookup.status === "ready" && !demo && isArea(lookup.types);
  const ready = lookup.status === "ready" && !areaSearch;
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
  const commute = useCommute({ subject: resultsPosition, listings: shown, mode });
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
  // Narrow screens: which tab of the shared panel is showing.
  const [panelTab, setPanelTab] = useState("property");
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
  const dataFetchedAt = comps.status === "ready" ? comps.data.listingsFetchedAt ?? null : null;
  useEffect(() => {
    // The demo isn't one of the user's own searches, so it isn't saved.
    if (demo || !ready || stage !== "results" || comps.status !== "ready") return;
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
          dataFetchedAt,
        }),
      }).catch((err) => console.error("Couldn't save search:", err));
    }, 1000);
    return () => clearTimeout(timer);
  }, [demo, ready, stage, comps.status, address, placeId, lookup, mode, radiusMiles, estimateAmount, nearbyCount, dataFetchedAt]);

  // What a payment on this page is for, and where Stripe returns the user
  // (straight back to these results).
  const purchase = ready
    ? {
        lat: lookup.position.lat,
        lng: lookup.position.lng,
        mode,
        label: `${lookup.formattedAddress} (${mode === "buy" ? "buying" : "renting"})`,
        returnTo: `/results?${new URLSearchParams({
          address: address || lookup.formattedAddress,
          ...(placeId && { placeId }),
          radius: String(Math.round(radiusMiles * 100) / 100),
          mode,
          from: "history",
        })}`,
      }
    : null;
  const access = comps.status === "ready" ? comps.data.access : null;
  // What's left on the user's plan; a new analysis returns the updated count.
  const usage = (ai.status === "ready" && ai.data?.usage) || access?.usage || null;
  // The open re-analysis tab, if any (a new analysis returns its new total).
  const tab = ai.status === "ready" && ai.data && "tab" in ai.data ? ai.data.tab : access?.tab || null;

  // The "no homes in this area" message, once closed, stays closed for that
  // radius and rent/buy choice (it comes back for a new one that's also empty).
  const [emptyDismissed, setEmptyDismissed] = useState(null);
  const emptyKey = `${mode}|${radiusMiles.toFixed(2)}`;
  // The "free AI analysis left" note, once closed, stays closed on this page.
  const [freeDismissed, setFreeDismissed] = useState(false);

  // "Show homes and analyze": the first AI analysis runs as soon as the homes
  // load (after paying, if the search needed unlocking, including a trip to
  // Stripe's page, so the wish is kept in this tab's storage for a while).
  const autoKey = ready ? `compd-auto-analyze|${lookup.formattedAddress}|${mode}` : null;
  function showHomes(analyze) {
    try {
      if (analyze && autoKey) window.sessionStorage.setItem(autoKey, String(Date.now()));
    } catch {}
    setStage("results");
  }
  useEffect(() => {
    if (!autoKey || stage !== "results" || comps.status !== "ready" || ai.status !== "idle") return;
    let asked = false;
    try {
      const at = Number(window.sessionStorage.getItem(autoKey));
      asked = Date.now() - at < 30 * 60_000;
    } catch {}
    if (!asked) return;
    // Wait briefly for the nearby-places counts, which the AI uses too.
    if (nearby.status === "loading") return;
    try {
      window.sessionStorage.removeItem(autoKey);
    } catch {}
    // Only the analysis the search includes (or a free one) runs by itself;
    // anything that would cost more waits for the Analyze button.
    const free = access && (access.aiIncludedLeft || access.source === "full" || access.demo);
    if (!free || shown.length === 0) return;
    ai.run({ current: priorities.current, payload: priorities.payload, filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, stage, comps.status, ai.status, nearby.status, access, shown.length]);

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
  // Minimizing is for the separate right-hand panel; on narrow screens the
  // AI has its own tab instead.
  const aiSection = (
    <AiRecommendation
      ai={ai}
      listingsById={listingsById}
      mode={mode}
      onSelect={setSelectedId}
      canRun={comps.status === "ready" && shown.length > 0}
      locked={comps.status === "locked"}
      access={access && { ...access, usage, tab }}
      purchase={purchase}
      priorities={priorities}
      prefsCtx={{ estimate: estimateAmount, radiusMiles }}
      collapsed={wide && aiCollapsed}
      onCollapse={wide ? setAiCollapsed : null}
      filters={filters}
      onFilters={setFilters}
      filtersControl={
        comps.status === "ready" && comps.nearby.length > 0 ? (
          <ListingFilters
            filters={filters}
            onChange={setFilters}
            showLand={comps.nearby.some((l) => typeGroup(l.type) === "land") || filters.types.includes("land")}
          />
        ) : null
      }
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
        {ready && stage === "results" && comps.status === "ready" && comps.nearby.length === 0 && (
          <div className={`empty-banners${wide && !aiCollapsed ? " empty-banners-with-ai" : ""}`}>
            {emptyDismissed !== emptyKey && (
              <EmptyBanner tone="main" onClose={() => setEmptyDismissed(emptyKey)}>
                No {mode === "rent" ? "rentals" : "homes for sale"} in this area. Try a wider radius or a different
                search.
              </EmptyBanner>
            )}
            {/* The analysis included with the search is still there to use. */}
            {!freeDismissed &&
              access?.aiIncludedLeft &&
              !ai.ranNew &&
              !access.demo &&
              access.source !== "full" && (
                <EmptyBanner tone="free" onClose={() => setFreeDismissed(true)}>
                  You still have one free AI analysis left!
                </EmptyBanner>
              )}
          </div>
        )}
      </div>

      {stage !== "results" && (
        <div className="flow-chip">
          <span className="flow-chip-address">{ready ? lookup.formattedAddress : address}</span>
          <Link href="/search">← Back to search</Link>
        </div>
      )}

      {areaSearch && (
        <div className="flow-card" role="dialog" aria-labelledby="area-title">
          <h2 id="area-title">That&apos;s an area, not a specific home</h2>
          <p className="panel-muted">
            {lookup.formattedAddress.replace(/,\s*USA$/, "")} covers many homes. Comp&apos;d compares one home
            against the homes around it, so enter the street address of a place you&apos;re considering, like
            &ldquo;123 Main St, San Luis Obispo, CA&rdquo;. You haven&apos;t been charged.
          </p>
          <div className="flow-card-actions">
            <Link href="/search" className="btn">
              Enter an address
            </Link>
            <Link href="/results?demo=1" className="btn btn-ghost">
              Try the free demo
            </Link>
          </div>
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
          <button type="button" className="btn flow-card-go" onClick={() => setStage("priorities")}>
            Next: what matters to you
          </button>
        </div>
      )}

      {ready && stage === "priorities" && (
        <div className="flow-card flow-card-priorities" role="dialog" aria-labelledby="priorities-title">
          <h2 id="priorities-title">What matters to you?</h2>
          <p className="panel-muted">
            Pick any priorities for your AI analysis. It runs as soon as the homes load
            {demo ? "." : ", and the first one is included with your search."}
          </p>
          <AiPreferences priorities={priorities} mode={mode} ctx={{ estimate: null, radiusMiles }} />
          <button type="button" className="btn flow-card-go" onClick={() => showHomes(true)}>
            Show homes and analyze
          </button>
          <button type="button" className="flow-card-skip" onClick={() => showHomes(false)}>
            Skip, just show the homes
          </button>
          <button type="button" className="flow-card-skip" onClick={() => setStage("radius")}>
            ← Back to the radius
          </button>
        </div>
      )}

      {ready && stage === "results" && (
        <aside className="results-panel">
          {/* Narrower screens have no room for a second panel, so the
              property details and the AI share this one, switched by tabs. */}
          {!wide && (
            <div className="panel-tabs" role="tablist" aria-label="Panel">
              {[
                ["property", "Property"],
                ["ai", "AI analysis"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={panelTab === id}
                  className={panelTab === id ? "panel-tab panel-tab-active" : "panel-tab"}
                  onClick={() => setPanelTab(id)}
                >
                  {label}
                  {id === "ai" && ai.picks.length > 0 && <span className="panel-tab-count">{ai.picks.length}</span>}
                </button>
              ))}
            </div>
          )}

          {!wide && panelTab === "ai" ? (
            aiSection
          ) : (
          <>
          {/* Back instead of a search bar: re-searching the same address
              would repeat lookups for no benefit. */}
          <Link href="/search" className="back-link">
            ← Back to search
          </Link>

          {demo && lookup.demoInfo && <DemoBanner info={lookup.demoInfo} />}

          <div className="panel-section">
            <p className="eyebrow">{demo ? "Free demo · comparing" : "Comparing"}</p>
            <h1>{lookup.formattedAddress}</h1>
            <div className="panel-row">{modeControls}</div>
            {comps.status === "locked" && purchase ? (
              <SearchPaywall comps={comps} purchase={purchase} />
            ) : (
              <Estimate comps={comps} mode={mode} />
            )}
            <PlanUsage usage={usage} />
          </div>

          <AreaInsights
            area={area}
            nearby={nearby}
            mode={mode}
            subjectBeds={comps.status === "ready" ? comps.data.estimate?.subject?.beds : null}
          />

          {comps.status === "ready" && <CommuteBox commute={commute} demo={demo} />}

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
          </>
          )}
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

// One message card over the map, with its own close button.
// `tone`: "main" (red text) or "free" (green text).
function EmptyBanner({ tone, onClose, children }) {
  return (
    <div className={`empty-banner empty-banner-${tone}`} role="status">
      <p>{children}</p>
      <button type="button" className="empty-banner-close" aria-label="Close this message" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

// The free demo's note: what it is, when it changes, and how to search your own.
function DemoBanner({ info }) {
  // The switch is at midnight UTC on Monday; show that date, not the local evening before.
  const ends = new Date(info.endsAt).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="demo-banner">
      <strong>Free demo</strong>
      <span>
        This week&apos;s address, picked by Comp&apos;d. A new one arrives {ends}. You get one custom AI analysis
        this week; <Link href="/search">search your own address</Link> for the full thing.
      </span>
    </div>
  );
}

function Estimate({ comps, mode }) {
  if (comps.status === "loading" || comps.status === "idle") {
    return <p className="panel-muted">Loading property data…</p>;
  }
  if (comps.status === "error" || comps.status === "locked") {
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
