"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "./format";
import { formatCount } from "./NearbyPlaces";

const BEDROOM_LABELS = ["Studio", "1 bd", "2 bd", "3 bd", "4 bd"];

// Loads public data about the searched property's area from /api/area.
export function useArea({ position, address, radiusMiles, fallbackZip, mode }) {
  const [state, setState] = useState({ status: "idle" });
  // Area facts barely depend on the radius, so only refetch per half mile.
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
        mode: mode || "rent",
      });
      if (fallbackZip) params.set("fallbackZip", fallbackZip);

      try {
        const res = await fetch(`/api/area?${params}`);
        const body = await res.json();
        if (cancelled) return;
        setState(res.ok ? { status: "ready", data: body } : { status: "error", message: body.error });
      } catch {
        if (!cancelled) setState({ status: "error", message: "Couldn't load area data." });
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [position, address, radiusBucket, fallbackZip, mode]);

  return state;
}

function percent(n) {
  if (n == null) return null;
  return `${n > 0 ? "+" : ""}${n}%`;
}

// `nearby` is the Google Places lookup from useNearbyPlaces.
export default function AreaInsights({ area, nearby, mode, subjectBeds, address }) {
  if (area.status === "idle") return null;

  return (
    <div className="panel-section">
      <h2>About this area</h2>
      {area.status === "loading" && <p className="panel-muted ai-loading">Loading public data…</p>}
      {area.status === "error" && <p className="panel-error">{area.message}</p>}
      {area.status === "ready" && (
        <AreaFacts data={area.data} nearby={nearby} mode={mode} subjectBeds={subjectBeds} />
      )}
      {area.status === "ready" && mode === "buy" && <BuyerFacts data={area.data} address={address} />}
    </div>
  );
}

const LEVEL_LABELS = { Elementary: "Elementary", Middle: "Middle", High: "High" };
const commas = (n) => n.toLocaleString();
// NCES grade codes: "KG–05" -> "K–5", "PK–08" -> "Pre-K–8".
const formatGrades = (g) =>
  g
    .split("–")
    .map((x) => (x === "KG" || x === "K" ? "K" : x === "PK" ? "Pre-K" : String(Number(x) || x)))
    .join("–");

// Schools, walkability, crime and zoning: shown when buying.
function BuyerFacts({ data, address }) {
  const { schools, walkability, crime } = data;
  return (
    <div className="buyer-facts">
      <h3>Schools nearby</h3>
      {schools?.nearest?.length ? (
        <>
          <ul className="school-list">
            {schools.nearest.map((s) => (
              <li key={s.name}>
                <span className="school-level">{LEVEL_LABELS[s.level]}</span>
                <span className="school-name">
                  {s.name}
                  {s.charter && <span className="school-charter">Charter</span>}
                </span>
                <span className="area-note">
                  {[
                    `${s.miles} mi`,
                    s.grades && `grades ${formatGrades(s.grades)}`,
                    s.students && `${commas(s.students)} students`,
                    s.studentsPerTeacher && `${s.studentsPerTeacher} per teacher`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="panel-muted pref-hint">
            Nearest public schools, not necessarily the assigned ones. Check {schools.nearest[0].district} for
            attendance zones.
          </p>
        </>
      ) : (
        <p className="panel-muted">{schools ? "No public schools within 3 mi." : "School data isn't available right now."}</p>
      )}

      <dl className="area-facts">
        {walkability && (
          <div className="area-fact">
            <dt>Walkability (EPA)</dt>
            <dd>
              {walkability.score} of 20 · {walkability.label}
              <span className="area-note">Based on street layout, mix of shops and homes, and transit</span>
            </dd>
          </div>
        )}
        {crime ? (
          <>
            <CrimeRow label="Violent crime" rates={crime.violent} />
            <CrimeRow label="Property crime" rates={crime.property} />
            <p className="panel-muted pref-hint">
              Reported to the FBI by {crime.agency} in {crime.year}, per 100,000 residents. Covers the whole
              jurisdiction, not this block.
            </p>
          </>
        ) : (
          <div className="area-fact">
            <dt>Crime (FBI)</dt>
            <dd>Not available for this spot</dd>
          </div>
        )}
      </dl>

      <Zoning address={address} />

      <p className="panel-credit">Sources: NCES, EPA, FBI Crime Data Explorer.</p>
    </div>
  );
}

function CrimeRow({ label, rates }) {
  const compare = rates.national
    ? Math.round(((rates.local - rates.national) / rates.national) * 100)
    : null;
  const high = compare != null && compare >= 25;
  return (
    <div className={high ? "area-fact area-fact-warn" : "area-fact"}>
      <dt>{label}</dt>
      <dd>
        {commas(rates.local)} per 100k
        {compare != null && ` · ${Math.abs(compare)}% ${compare >= 0 ? "above" : "below"} U.S.`}
        <span className="area-note">
          {[rates.state && `State ${commas(rates.state)}`, rates.national && `U.S. ${commas(rates.national)}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </dd>
    </div>
  );
}

// Zoning comes from the county property record, which costs a paid lookup,
// so it is only fetched when the user asks (a saved answer shows right away).
function Zoning({ address }) {
  const [state, setState] = useState({ status: "checking" });

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setState({ status: "checking" });
    fetch(`/api/zoning?${new URLSearchParams({ address })}`)
      .then((r) => r.json())
      .then((body) => !cancelled && setState(body.status === "ready" ? body : { status: "idle" }))
      .catch(() => !cancelled && setState({ status: "idle" }));
    return () => {
      cancelled = true;
    };
  }, [address]);

  async function lookUp() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/zoning?${new URLSearchParams({ address, fetch: "1" })}`);
      const body = await res.json();
      setState(res.ok ? body : { status: "error", message: body.error });
    } catch {
      setState({ status: "error", message: "Couldn't look up zoning." });
    }
  }

  return (
    <dl className="area-facts zoning">
      <div className="area-fact">
        <dt>Zoning</dt>
        <dd>
          {state.status === "ready" ? (
            <>
              {state.zoning || "Not on the county record"}
              {state.lotSize ? ` · ${commas(state.lotSize)} sq ft lot` : ""}
              <span className="area-note">
                From the county property record. Codes differ by city; check the city&apos;s zoning map for what&apos;s
                allowed.
              </span>
            </>
          ) : state.status === "loading" || state.status === "checking" ? (
            <span className="panel-muted">{state.status === "loading" ? "Looking up…" : "…"}</span>
          ) : (
            <>
              <button type="button" className="btn btn-small" onClick={lookUp}>
                Look up zoning
              </button>
              {state.status === "error" && <span className="panel-error"> {state.message}</span>}
              <span className="area-note">Uses one property lookup</span>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

function AreaFacts({ data, nearby, mode, subjectBeds }) {
  const { fairMarketRent: fmr, neighborhood, trends, flood } = data;
  const amenities = nearby.status === "ready" ? nearby.data : null;
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
    const count = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`;
    const bits = [
      count(amenities.groceriesWithinHalfMile, "grocery store", "grocery stores"),
      count(amenities.parksWithinHalfMile, "park", "parks"),
      count(amenities.restaurantsAndCafesWithinHalfMile, "restaurant/cafe", "restaurants & cafes"),
    ];
    rows.push({ label: "Within ½ mile", value: bits.join(" · ") });
    rows.push({
      label: "Transit stops within ¼ mile",
      value: formatCount(amenities.transitStopsWithinQuarterMile),
      note:
        amenities.nearestGroceryMiles != null
          ? `Nearest grocery: ${amenities.nearestGroceryMiles} mi`
          : "No grocery store within 2 mi",
    });
  } else if (nearby.status === "loading" || nearby.status === "idle") {
    rows.push({ label: "Nearby places", value: "Loading…" });
  } else {
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
        Sources: HUD, U.S. Census Bureau, Zillow Research, FEMA, Google.
      </p>
    </>
  );
}
