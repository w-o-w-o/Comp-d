"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "./format";
import { formatCount } from "./NearbyPlaces";
import Collapsible from "./Collapsible";

const BEDROOM_LABELS = ["Studio", "1 bd", "2 bd", "3 bd", "4 bd"];

// Loads public data about the searched property's area from /api/area.
export function useArea({ position, address, radiusMiles, fallbackZip }) {
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
  }, [position, address, radiusBucket, fallbackZip]);

  return state;
}

const commas = (n) => n.toLocaleString();
const percent = (n) => (n == null ? null : `${n > 0 ? "+" : ""}${n}%`);
const LEVEL_LABELS = { Elementary: "Elementary", Middle: "Middle", High: "High" };
// NCES grade codes: "KG–05" -> "K–5", "PK–08" -> "Pre-K–8".
const formatGrades = (g) =>
  g
    .split("–")
    .map((x) => (x === "KG" || x === "K" ? "K" : x === "PK" ? "Pre-K" : String(Number(x) || x)))
    .join("–");

// Area facts, one closed section per topic so the panel stays short.
// `nearby` is the Google Places lookup from useNearbyPlaces.
export default function AreaInsights({ area, nearby, mode, subjectBeds }) {
  if (area.status === "idle") return null;

  return (
    <div className="panel-section">
      <h2>About this area</h2>
      {area.status === "loading" && <p className="panel-muted ai-loading">Loading public data…</p>}
      {area.status === "error" && <p className="panel-error">{area.message}</p>}
      {area.status === "ready" && (
        <div className="collapsible-list">
          <PricesSection data={area.data} mode={mode} subjectBeds={subjectBeds} />
          <FloodSection flood={area.data.flood} />
          <NearbySection nearby={nearby} />
          <SchoolsSection schools={area.data.schools} />
          <WalkabilitySection walkability={area.data.walkability} />
          <CrimeSection crime={area.data.crime} />
        </div>
      )}
    </div>
  );
}

function Facts({ rows }) {
  return (
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
  );
}

function PricesSection({ data, mode, subjectBeds }) {
  const { fairMarketRent: fmr, neighborhood, trends } = data;
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

  const typical = trends && (mode === "rent" ? trends.typicalRent : trends.typicalHomeValue);
  const change = trends && (mode === "rent" ? trends.rentChangeYoY : trends.homeValueChangeYoY);
  if (typical) {
    rows.push({
      label: mode === "rent" ? "Typical rent (Zillow)" : "Typical home value (Zillow)",
      value: `${formatPrice(typical, mode)}${change != null ? ` · ${percent(change)} in a year` : ""}`,
      note: `ZIP ${trends.zip}`,
    });
  }

  const median = mode === "rent" ? neighborhood?.medianRent : neighborhood?.medianHomeValue;
  if (median) {
    rows.push({
      label: mode === "rent" ? "Neighborhood median rent" : "Neighborhood median home value",
      value: formatPrice(median, mode),
      note: `Census, all ${mode === "rent" ? "renters" : "owners"} (${neighborhood.year})`,
    });
  }

  const peek = typical
    ? `Typical ${formatPrice(typical, mode)}${change != null ? ` (${percent(change)})` : ""}`
    : rows.length
      ? null
      : "No data";
  return (
    <Collapsible title="Prices in this area" peek={peek}>
      {rows.length ? <Facts rows={rows} /> : <p className="panel-muted">No price benchmarks for this spot.</p>}
      <p className="panel-credit">Sources: HUD, U.S. Census Bureau, Zillow Research.</p>
    </Collapsible>
  );
}

const FLOOD_PEEK = {
  high: "High risk",
  moderate: "Moderate risk",
  minimal: "Minimal risk",
  undetermined: "Not determined",
  unmapped: "Not mapped",
};

function FloodSection({ flood }) {
  return (
    <Collapsible title="Flood risk" peek={flood ? FLOOD_PEEK[flood.risk] : "Not available"} warn={flood?.risk === "high"}>
      {flood ? (
        <Facts rows={[{ label: "Flood zone (FEMA)", value: flood.label, warn: flood.risk === "high" }]} />
      ) : (
        <p className="panel-muted">FEMA flood data isn&apos;t available right now.</p>
      )}
      <p className="panel-credit">Source: FEMA flood maps.</p>
    </Collapsible>
  );
}

function NearbySection({ nearby }) {
  const a = nearby.status === "ready" ? nearby.data : null;
  const count = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`;
  const peek = a
    ? `${count(a.groceriesWithinHalfMile, "grocery", "groceries")} · ${count(a.transitStopsWithinQuarterMile, "transit stop", "transit stops")}`
    : nearby.status === "error"
      ? "Not available"
      : "Loading…";
  return (
    <Collapsible title="Nearby places" peek={peek}>
      {a ? (
        <Facts
          rows={[
            {
              label: "Within ½ mile",
              value: [
                count(a.groceriesWithinHalfMile, "grocery store", "grocery stores"),
                count(a.parksWithinHalfMile, "park", "parks"),
                count(a.restaurantsAndCafesWithinHalfMile, "restaurant/cafe", "restaurants & cafes"),
              ].join(" · "),
            },
            {
              label: "Transit stops within ¼ mile",
              value: formatCount(a.transitStopsWithinQuarterMile),
              note:
                a.nearestGroceryMiles != null
                  ? `Nearest grocery: ${a.nearestGroceryMiles} mi`
                  : "No grocery store within 2 mi",
            },
          ]}
        />
      ) : (
        <p className="panel-muted">{peek}</p>
      )}
      <p className="panel-credit">Source: Google Maps.</p>
    </Collapsible>
  );
}

function SchoolsSection({ schools }) {
  const peek = schools?.districts?.length
    ? schools.districts.join(" & ")
    : schools?.nearest?.length
      ? `${schools.nearest.length} nearby`
      : "Not available";
  return (
    <Collapsible title="Schools" peek={peek}>
      {schools?.districts?.length > 0 && (
        <p className="school-district">
          School district: <strong>{schools.districts.join(" and ")}</strong>
        </p>
      )}
      {schools?.nearest?.length ? (
        <>
          <ul className="school-list">
            {schools.nearest.map((s) => (
              <li key={s.name}>
                <span className="school-level">{LEVEL_LABELS[s.level]}</span>
                <span className="school-name">
                  {s.name}
                  {s.charter && <span className="school-charter">Charter</span>}
                  {schools.districts?.length > 0 && !s.inDistrict && !s.charter && (
                    <span className="school-charter">Other district</span>
                  )}
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
            Nearest public schools{schools.districts?.length ? " in this district" : ""}. The assigned school can
            differ; check {schools.districts?.[0] || schools.nearest[0].district}&apos;s school finder for this
            address.
          </p>
        </>
      ) : (
        <p className="panel-muted">
          {schools ? "No public schools within 5 mi." : "School data isn't available right now."}
        </p>
      )}
      <p className="panel-credit">Source: National Center for Education Statistics (2024–25).</p>
    </Collapsible>
  );
}

function WalkabilitySection({ walkability }) {
  return (
    <Collapsible title="Walkability" peek={walkability ? `${walkability.score}/20 · ${walkability.label}` : "Not available"}>
      {walkability ? (
        <Facts
          rows={[
            {
              label: "EPA Walkability Index",
              value: `${walkability.score} of 20 · ${walkability.label}`,
              note: "Based on street layout, mix of shops and homes, and transit access in this neighborhood",
            },
          ]}
        />
      ) : (
        <p className="panel-muted">Walkability data isn&apos;t available for this spot.</p>
      )}
      <p className="panel-credit">Source: U.S. EPA National Walkability Index.</p>
    </Collapsible>
  );
}

// Percent above (+) or below (-) the U.S. rate.
export function vsNational(rates) {
  return rates?.national ? Math.round(((rates.local - rates.national) / rates.national) * 100) : null;
}

function CrimeSection({ crime }) {
  const v = vsNational(crime?.violent);
  const p = vsNational(crime?.property);
  const describe = (n) => (n == null ? "?" : `${Math.abs(n)}% ${n >= 0 ? "above" : "below"} U.S.`);
  const peek = crime ? `Violent ${describe(v)}` : "Not available";
  return (
    <Collapsible title="Crime" peek={peek} warn={v != null && v >= 25}>
      {crime ? (
        <>
          <Facts
            rows={[
              { label: "Violent crime", rates: crime.violent, compare: v },
              { label: "Property crime", rates: crime.property, compare: p },
            ].map(({ label, rates, compare }) => ({
              label,
              warn: compare != null && compare >= 25,
              value: `${commas(rates.local)} per 100k${compare != null ? ` · ${describe(compare)}` : ""}`,
              note: [rates.state && `State ${commas(rates.state)}`, rates.national && `U.S. ${commas(rates.national)}`]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
          <p className="panel-muted pref-hint">
            Reported to the FBI by {crime.agency} in {crime.year}, per 100,000 residents. Covers the whole
            jurisdiction, not this block.
          </p>
        </>
      ) : (
        <p className="panel-muted">No FBI crime data for the local police agency.</p>
      )}
      <p className="panel-credit">Source: FBI Crime Data Explorer.</p>
    </Collapsible>
  );
}
