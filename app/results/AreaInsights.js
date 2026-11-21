"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "./format";

const BEDROOM_LABELS = ["Studio", "1 bd", "2 bd", "3 bd", "4 bd"];

// Loads public data about the searched property's area from /api/area.
export function useArea({ position, address, radiusMiles, fallbackZip }) {
  const [state, setState] = useState({ status: "idle" });
  // Amenity counts depend on the radius only loosely, so refetch per half mile.
  const radiusBucket = Math.ceil(radiusMiles * 2) / 2;

  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({
        lat: String(position.lat),
        lng: String(position.lng),
        radius: String(radiusBucket),
        address: address || "",
      });
      if (fallbackZip) params.set("fallbackZip", fallbackZip);

      // Nearby places load separately (slower); they fill in when they arrive.
      const amenities = fetch(`/api/area?${params}&part=amenities`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      try {
        const res = await fetch(`/api/area?${params}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error", message: body.error });
          return;
        }
        setState({ status: "ready", data: body, amenitiesLoading: true });
        const extra = await amenities;
        if (!cancelled) {
          setState({
            status: "ready",
            data: { ...body, amenities: extra?.amenities ?? null },
            amenitiesLoading: false,
          });
        }
      } catch {
        if (!cancelled) setState({ status: "error", message: "Couldn't load area data." });
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [position, address, radiusBucket, fallbackZip]);

  return state;
}

function percent(n) {
  if (n == null) return null;
  return `${n > 0 ? "+" : ""}${n}%`;
}

export default function AreaInsights({ area, mode, subjectBeds }) {
  if (area.status === "idle") return null;

  return (
    <div className="panel-section">
      <h2>About this area</h2>
      {area.status === "loading" && <p className="panel-muted ai-loading">Loading public data…</p>}
      {area.status === "error" && <p className="panel-error">{area.message}</p>}
      {area.status === "ready" && (
        <AreaFacts
          data={area.data}
          mode={mode}
          subjectBeds={subjectBeds}
          amenitiesLoading={area.amenitiesLoading}
        />
      )}
    </div>
  );
}

function AreaFacts({ data, mode, subjectBeds, amenitiesLoading }) {
  const { fairMarketRent: fmr, neighborhood, trends, flood, amenities } = data;
  const rows = [];

  if (mode === "rent" && fmr) {
    const beds = Number.isInteger(subjectBeds) && subjectBeds >= 0 && subjectBeds <= 4 ? subjectBeds : null;
    rows.push({
      label: "HUD fair market rent",
      value:
        beds != null
          ? `${formatPrice(fmr.byBedrooms[beds], "rent")} for ${BEDROOM_LABELS[beds]}`
          : fmr.byBedrooms
              .map((v, i) => (v ? `${BEDROOM_LABELS[i]} ${formatPrice(v, "rent")}` : null))
              .filter(Boolean)
              .slice(1, 4)
              .join(" · "),
      note: fmr.smallArea ? "This ZIP code" : fmr.area,
    });
  }

  if (trends) {
    const typical = mode === "rent" ? trends.typicalRent : trends.typicalHomeValue;
    const change = mode === "rent" ? trends.rentChangeYoY : trends.homeValueChangeYoY;
    if (typical) {
      rows.push({
        label: mode === "rent" ? "Typical rent (Zillow)" : "Typical home value (Zillow)",
        value: `${formatPrice(typical, mode)}${change != null ? ` · ${percent(change)} in a year` : ""}`,
        note: `ZIP ${trends.zip}`,
      });
    }
  }

  const median = mode === "rent" ? neighborhood?.medianRent : neighborhood?.medianHomeValue;
  if (median) {
    rows.push({
      label: mode === "rent" ? "Neighborhood median rent" : "Neighborhood median home value",
      value: formatPrice(median, mode),
      note: `Census, all ${mode === "rent" ? "renters" : "owners"} (${neighborhood.year})`,
    });
  }

  if (flood) {
    rows.push({ label: "Flood zone (FEMA)", value: flood.label, warn: flood.risk === "high" });
  }

  if (amenities) {
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const bits = [
      count(amenities.groceriesWithinHalfMile, "grocery store", "grocery stores"),
      count(amenities.parksWithinHalfMile, "park", "parks"),
      count(amenities.restaurantsAndCafesWithinHalfMile, "restaurant/cafe", "restaurants & cafes"),
    ];
    rows.push({ label: "Within ½ mile", value: bits.join(" · ") });
    rows.push({
      label: "Transit stops within ¼ mile",
      value: String(amenities.transitStopsWithinQuarterMile),
      note:
        amenities.nearestGroceryMiles != null
          ? `Nearest grocery: ${amenities.nearestGroceryMiles} mi`
          : null,
    });
  }

  if (amenitiesLoading) {
    rows.push({ label: "Nearby places", value: "Loading…" });
  } else if (!amenities) {
    rows.push({ label: "Nearby places", value: "Not available right now" });
  }

  if (rows.length === 0) {
    return <p className="panel-muted">No public data was available for this spot.</p>;
  }

  return (
    <>
      <dl className="area-facts">
        {rows.map((r) => (
          <div key={r.label} className={r.warn ? "area-fact area-fact-warn" : "area-fact"}>
            <dt>{r.label}</dt>
            <dd>
              {r.value}
              {r.note && <span className="area-note">{r.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="panel-credit">
        Sources: HUD, U.S. Census Bureau, Zillow Research, FEMA, OpenStreetMap contributors.
      </p>
    </>
  );
}
