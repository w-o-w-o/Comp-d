"use client";

import { useEffect, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { distanceMiles } from "./geo";

// Google returns at most 20 places per search, so a count of 20 means "20 or more".
export const MAX_PLACES = 20;
const METERS_PER_MILE = 1609.34;

// One Google Places "nearby search" per category (each is billed separately).
const SEARCHES = {
  // Searched wider so the nearest one can be found even if it's past ½ mile.
  grocery: { filter: { includedPrimaryTypes: ["grocery_store", "supermarket"] }, miles: 2, countWithin: 0.5 },
  park: { filter: { includedTypes: ["park"] }, miles: 0.5 },
  food: { filter: { includedTypes: ["restaurant", "cafe", "coffee_shop"] }, miles: 0.5 },
  transit: {
    filter: {
      includedTypes: ["bus_stop", "transit_station", "train_station", "light_rail_station", "subway_station"],
    },
    miles: 0.25,
  },
};

// Results for places already looked up in this visit, so going back and forth
// between searches doesn't pay for the same lookups again.
const memory = new Map();

async function lookUp(placesLib, center) {
  const { Place, SearchNearbyRankPreference } = placesLib;
  const run = ([name, s]) =>
    Place.searchNearby({
      fields: ["location"],
      locationRestriction: { center, radius: Math.round(s.miles * METERS_PER_MILE) },
      maxResultCount: MAX_PLACES,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
      ...s.filter,
    }).then(({ places }) => [
      name,
      places
        .map((p) => p.location)
        .filter(Boolean)
        .map((loc) => distanceMiles(center, { lat: loc.lat(), lng: loc.lng() })),
    ]);
  const found = Object.fromEntries(await Promise.all(Object.entries(SEARCHES).map(run)));

  // Results are nearest first, so a full page of results all inside the
  // distance means there may be more than we were shown.
  const count = (name, miles) => Math.min(found[name].filter((d) => d <= miles).length, MAX_PLACES);
  return {
    groceriesWithinHalfMile: count("grocery", 0.5),
    nearestGroceryMiles: found.grocery.length ? Math.round(found.grocery[0] * 100) / 100 : null,
    parksWithinHalfMile: count("park", 0.5),
    restaurantsAndCafesWithinHalfMile: count("food", 0.5),
    transitStopsWithinQuarterMile: count("transit", 0.25),
  };
}

// Groceries, parks, restaurants/cafes and transit stops around one point,
// from Google Places (runs in the browser with the same key as the map).
// Each result is saved on the server (lib/nearby.js), so reopening a search
// doesn't repeat the 4 paid lookups.
export function useNearbyPlaces(position) {
  const placesLib = useMapsLibrary("places");
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!position || !placesLib) return;
    const key = `${position.lat.toFixed(4)},${position.lng.toFixed(4)}`;
    if (memory.has(key)) {
      setState({ status: "ready", data: memory.get(key) });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const { lat, lng } = position;
    (async () => {
      // Saved from an earlier visit? Then no Google requests are needed.
      const saved = await fetch(`/api/nearby?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      let data = saved?.data;
      if (!data) {
        data = await lookUp(placesLib, { lat, lng });
        fetch("/api/nearby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, data }),
        }).catch(() => {});
      }
      memory.set(key, data);
      if (!cancelled) setState({ status: "ready", data });
    })().catch((err) => {
      console.error("Nearby places lookup failed:", err);
      if (!cancelled) setState({ status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [position, placesLib]);

  return state;
}

export function formatCount(n) {
  return n >= MAX_PLACES ? `${MAX_PLACES}+` : String(n);
}
