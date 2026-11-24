"use client";

import { useEffect, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import Collapsible from "./Collapsible";

// Listings included in one commute calculation (Google allows up to 100
// origin-destination pairs per request for transit).
export const COMMUTE_LISTINGS = 40;

const MODES = [
  ["DRIVING", "Drive"],
  ["TRANSIT", "Transit"],
  ["BICYCLING", "Bike"],
  ["WALKING", "Walk"],
];

export const MODE_LABELS = Object.fromEntries(MODES);

// Each search can run this many commute checks (each is a paid Google request).
export const COMMUTE_LIMIT = 3;

const normalize = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

// Travel times from the property and nearby listings to a destination, using
// the Google Maps Routes library (the same browser key as the map). Up to
// COMMUTE_LIMIT checks per search are saved on the server (/api/commutes);
// one of them is shown at a time, and picking a saved one costs nothing.
export function useCommute({ subject, listings, mode }) {
  const routes = useMapsLibrary("routes");
  const [checks, setChecks] = useState([]);
  const [active, setActive] = useState(-1);
  // A check in progress or one that failed: { status, destination, travelMode, message }
  const [pending, setPending] = useState(null);
  const lat = subject?.lat;
  const lng = subject?.lng;

  // Load this search's saved checks (and start fresh when it changes).
  useEffect(() => {
    setChecks([]);
    setActive(-1);
    setPending(null);
    if (lat == null || lng == null) return;
    let cancelled = false;
    fetch(`/api/commutes?${new URLSearchParams({ lat: String(lat), lng: String(lng), mode })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.checks?.length) return;
        setChecks(body.checks);
        setActive(body.checks.length - 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lat, lng, mode]);

  async function compute(destination, travelMode) {
    if (!routes || !subject || !destination.trim()) return;
    // Already checked: just show it again.
    const existing = checks.findIndex(
      (c) => normalize(c.destination) === normalize(destination) && c.travelMode === travelMode
    );
    if (existing !== -1) {
      setPending(null);
      setActive(existing);
      return;
    }
    if (checks.length >= COMMUTE_LIMIT) {
      setPending({
        status: "error",
        destination,
        travelMode,
        message: `You've used all ${COMMUTE_LIMIT} commute checks for this search. Pick a saved one below.`,
      });
      return;
    }
    const included = listings.slice(0, COMMUTE_LISTINGS);
    setPending({ status: "loading", destination, travelMode });
    try {
      const { matrix } = await routes.RouteMatrix.computeRouteMatrix({
        origins: [subject, ...included.map((l) => ({ lat: l.lat, lng: l.lng }))],
        destinations: [destination.trim()],
        travelMode,
        fields: ["durationMillis", "distanceMeters", "condition"],
      });
      const route = (row) => {
        const item = row?.items?.[0];
        return item?.condition === "ROUTE_EXISTS" ? item : null;
      };
      const minutes = (row) => {
        const item = route(row);
        return item && Number.isFinite(item.durationMillis) ? Math.round(item.durationMillis / 60000) : null;
      };
      // Route distance (not straight-line), to one decimal place.
      const miles = (row) => {
        const item = route(row);
        return item && Number.isFinite(item.distanceMeters) ? Math.round(item.distanceMeters / 160.934) / 10 : null;
      };
      const byListing = {};
      const milesByListing = {};
      included.forEach((l, i) => {
        byListing[l.id] = minutes(matrix.rows[i + 1]);
        milesByListing[l.id] = miles(matrix.rows[i + 1]);
      });
      const check = {
        destination: destination.replace(/\s+/g, " ").trim(),
        travelMode,
        subjectMinutes: minutes(matrix.rows[0]),
        subjectMiles: miles(matrix.rows[0]),
        byListing,
        milesByListing,
      };
      const next = [...checks, check];
      setChecks(next);
      setActive(next.length - 1);
      setPending(null);
      // Save it with the search (the server also enforces the limit).
      fetch("/api/commutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: subject.lat, lng: subject.lng, mode, check }),
      }).catch(() => {});
    } catch (err) {
      console.error("Commute calculation failed:", err);
      setPending({
        status: "error",
        destination,
        travelMode,
        message: "Couldn't calculate commute times. Check the destination and try again.",
      });
    }
  }

  const shown = checks[active];
  const state = pending
    ? pending
    : shown
      ? { status: "ready", ...shown }
      : { status: "idle" };
  return {
    ...state,
    compute,
    checks,
    active,
    select: (i) => {
      setPending(null);
      setActive(i);
    },
    limit: COMMUTE_LIMIT,
    available: Boolean(routes),
  };
}

// "12 min drive · 4.3 mi"; miles are the route's length, when known.
export function formatCommute(minutes, travelMode, miles = null) {
  if (minutes == null) return null;
  const verb = { DRIVING: "drive", TRANSIT: "by transit", BICYCLING: "bike", WALKING: "walk" }[travelMode];
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
  return `${time} ${verb}${miles != null ? ` · ${miles} mi` : ""}`;
}

export default function CommuteBox({ commute }) {
  const [destination, setDestination] = useState(commute.destination || "");
  const [travelMode, setTravelMode] = useState(commute.travelMode || "DRIVING");

  function submit(e) {
    e.preventDefault();
    commute.compute(destination, travelMode);
  }

  const used = commute.checks.length;
  const atLimit = used >= commute.limit;
  // Re-checking a saved destination is free, so only a new one is blocked.
  const isSaved = commute.checks.some(
    (c) => normalize(c.destination) === normalize(destination) && c.travelMode === travelMode
  );
  const peek =
    commute.status === "ready"
      ? formatCommute(commute.subjectMinutes, commute.travelMode, commute.subjectMiles) || "No route"
      : used
        ? `${used} saved`
        : "Add a destination";
  return (
    <div className="panel-section panel-section-tight">
      <Collapsible title="Commute" peek={peek}>
      <form className="commute-form" onSubmit={submit}>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Work, school, or any address"
          aria-label="Commute destination"
        />
        <div className="commute-row">
          <div className="mode-toggle" role="group" aria-label="Travel mode">
            {MODES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={travelMode === value ? "chip chip-active" : "chip"}
                aria-pressed={travelMode === value}
                onClick={() => setTravelMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="btn btn-small"
            disabled={
              !destination.trim() || !commute.available || commute.status === "loading" || (atLimit && !isSaved)
            }
          >
            {commute.status === "loading" ? "…" : isSaved ? "Show" : "Check"}
          </button>
        </div>
      </form>

      {used > 0 && (
        <div className="commute-saved">
          <div className="commute-saved-head">
            <span>Saved for this search</span>
            <span className={atLimit ? "commute-count commute-count-full" : "commute-count"}>
              {used} of {commute.limit} checks used
            </span>
          </div>
          <div className="commute-saved-list" role="group" aria-label="Saved commutes">
            {commute.checks.map((c, i) => (
              <button
                key={`${c.destination}|${c.travelMode}`}
                type="button"
                className={i === commute.active && commute.status === "ready" ? "commute-saved-item commute-saved-active" : "commute-saved-item"}
                aria-pressed={i === commute.active && commute.status === "ready"}
                onClick={() => {
                  commute.select(i);
                  setDestination(c.destination);
                  setTravelMode(c.travelMode);
                }}
              >
                <span className="commute-saved-dest">{c.destination}</span>
                <span className="commute-saved-time">
                  {formatCommute(c.subjectMinutes, c.travelMode, c.subjectMiles) || `${MODE_LABELS[c.travelMode]} · no route`}
                </span>
              </button>
            ))}
          </div>
          {atLimit && (
            <p className="panel-muted pref-hint">
              That&apos;s the limit for this search. Saved commutes stay here for 7 days, along with the search.
            </p>
          )}
        </div>
      )}
      {commute.status === "ready" && (
        <p className="panel-muted">
          From this property:{" "}
          <strong>
            {formatCommute(commute.subjectMinutes, commute.travelMode, commute.subjectMiles) || "no route found"}
          </strong>{" "}
          to {commute.destination}. Times also show on each listing.
        </p>
      )}
      {commute.status === "error" && <p className="panel-error">{commute.message}</p>}
      </Collapsible>
    </div>
  );
}
