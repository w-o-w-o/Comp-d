"use client";

import { useState } from "react";
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

// Travel times from the property and nearby listings to one destination,
// using the Google Maps Routes library (the same browser key as the map).
export function useCommute({ subject, listings }) {
  const routes = useMapsLibrary("routes");
  const [state, setState] = useState({ status: "idle" });

  async function compute(destination, travelMode) {
    if (!routes || !subject || !destination.trim()) return;
    const included = listings.slice(0, COMMUTE_LISTINGS);
    setState({ status: "loading", destination, travelMode });
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
      setState({
        status: "ready",
        destination: destination.trim(),
        travelMode,
        subjectMinutes: minutes(matrix.rows[0]),
        subjectMiles: miles(matrix.rows[0]),
        byListing,
        milesByListing,
      });
    } catch (err) {
      console.error("Commute calculation failed:", err);
      setState({
        status: "error",
        destination,
        travelMode,
        message: "Couldn't calculate commute times. Check the destination and try again.",
      });
    }
  }

  return { ...state, compute, available: Boolean(routes) };
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

  const peek =
    commute.status === "ready"
      ? formatCommute(commute.subjectMinutes, commute.travelMode, commute.subjectMiles) || "No route"
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
            disabled={!destination.trim() || !commute.available || commute.status === "loading"}
          >
            {commute.status === "loading" ? "…" : "Check"}
          </button>
        </div>
      </form>
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
