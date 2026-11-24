// Priorities a user can give the AI analysis, shared by the page (buttons and
// controls) and the server (checking each listing against them).

const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const shortMoney = (n) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : n >= 10_000 ? `$${Math.round(n / 1000)}k` : money(n));

// Index = the "Near schools" level value.
const SCHOOL_LEVEL_OPTIONS = [
  { key: "any", label: "Any", short: "A school" },
  { key: "elementary", label: "Elementary", short: "Elementary school" },
  { key: "middle", label: "Middle", short: "Middle school" },
  { key: "high", label: "High", short: "High school" },
];

// EPA Walkability Index bands (values are the lower bound of each band).
const WALK_OPTIONS = [
  { value: 10.5, label: "Above average" },
  { value: 15.25, label: "Most walkable" },
];

export const MAX_CUSTOM = 5;
export const MAX_CUSTOM_LENGTH = 80;

// control: "range" shows a slider, "select" a row of choices, none shows only
// the importance toggle. `check(listing, value, ctx)` returns true (meets it),
// false (doesn't), or null (the data doesn't say); omitted = not checkable.
export const PREFERENCES = [
  {
    id: "budget",
    label: "Budget",
    modes: ["rent", "buy"],
    defaultMust: true,
    control: (mode) =>
      mode === "rent"
        ? { type: "range", min: 500, max: 10000, step: 50, label: "Max rent", format: (v) => `${money(v)}/mo` }
        : { type: "range", min: 100000, max: 3000000, step: 10000, label: "Max price", format: shortMoney },
    defaultValue: (mode, { estimate }) =>
      estimate ? Math.round(estimate / (mode === "rent" ? 50 : 10000)) * (mode === "rent" ? 50 : 10000) : mode === "rent" ? 3000 : 800000,
    summary: (v, mode) => (mode === "rent" ? `Under ${money(v)}/mo` : `Under ${shortMoney(v)}`),
    check: (l, v) => l.price <= v,
  },
  {
    id: "payment",
    label: "Monthly payment",
    modes: ["buy"],
    hint: "Estimates principal and interest on a 30-year loan, plus any HOA fee. Taxes and insurance aren't included.",
    controls: [
      { key: "down", type: "range", min: 0, max: 50, step: 1, label: "Down payment", format: (v) => `${v}%` },
      { key: "rate", type: "range", min: 3, max: 10, step: 0.125, label: "Interest rate", format: (v) => `${v}%` },
      { key: "max", type: "range", min: 500, max: 20000, step: 100, label: "Max monthly payment", format: (v) => `${money(v)}/mo` },
    ],
    defaultValue: () => ({ down: 20, rate: 6.5, max: 4000 }),
    summary: (v) => `Under ${money(v.max)}/mo (${v.down}% down, ${v.rate}%)`,
    check: (l, v) => monthlyPayment(l.price, v, l.hoaFee) <= v.max,
  },
  {
    id: "roommates",
    label: "Splitting rent",
    modes: ["rent"],
    hint: "Compares the rent per person, and looks for a bedroom for each person.",
    control: () => ({ type: "range", min: 2, max: 6, step: 1, label: "People", format: (v) => `${v} people` }),
    defaultValue: () => 2,
    summary: (v) => `${v} people sharing`,
    check: (l, v) => (l.beds == null ? null : l.beds >= v),
  },
  {
    id: "space",
    label: "More space",
    modes: ["rent", "buy"],
    hint: "Many rentals don't list their size; those count as unknown.",
    control: () => ({ type: "range", min: 300, max: 5000, step: 50, label: "At least", format: (v) => `${v.toLocaleString("en-US")} sq ft` }),
    defaultValue: () => 1000,
    summary: (v) => `${v.toLocaleString("en-US")}+ sq ft`,
    check: (l, v) => (l.sqft == null ? null : l.sqft >= v),
  },
  {
    id: "baths",
    label: "Bathrooms",
    modes: ["rent", "buy"],
    control: () => ({ type: "select", label: "At least", options: [1, 1.5, 2, 2.5, 3].map((n) => ({ value: n, label: n === 3 ? "3+" : String(n) })) }),
    defaultValue: () => 2,
    summary: (v) => `${v}+ baths`,
    check: (l, v) => (l.baths == null ? null : l.baths >= v),
  },
  {
    id: "newer",
    label: "Newer building",
    modes: ["rent", "buy"],
    hint: "Year built is missing for many rentals; those count as unknown.",
    control: () => ({ type: "range", min: 1900, max: 2025, step: 5, label: "Built in or after", format: String }),
    defaultValue: () => 2000,
    summary: (v) => `Built ${v} or later`,
    check: (l, v) => (l.yearBuilt == null ? null : l.yearBuilt >= v),
  },
  {
    id: "lot",
    label: "Bigger lot",
    modes: ["buy"],
    control: () => ({ type: "range", min: 2000, max: 43560, step: 500, label: "Lot at least", format: (v) => (v >= 43560 ? "1 acre" : `${v.toLocaleString("en-US")} sq ft`) }),
    defaultValue: () => 6000,
    summary: (v) => `Lot ${v >= 43560 ? "1 acre" : `${v.toLocaleString("en-US")}+ sq ft`}`,
    check: (l, v) => (l.lotSize == null ? null : l.lotSize >= v),
  },
  {
    id: "hoa",
    label: "Low HOA",
    modes: ["buy"],
    control: () => ({ type: "range", min: 0, max: 1500, step: 25, label: "HOA at most", format: (v) => (v === 0 ? "No HOA" : `${money(v)}/mo`) }),
    defaultValue: () => 300,
    summary: (v) => (v === 0 ? "No HOA" : `HOA under ${money(v)}/mo`),
    // No fee listed usually means no HOA.
    check: (l, v) => (l.hoaFee ?? 0) <= v,
  },
  {
    id: "close",
    label: "Close to this address",
    modes: ["rent", "buy"],
    control: (mode, { radiusMiles }) => ({ type: "range", min: 0.25, max: Math.max(0.5, radiusMiles), step: 0.25, label: "Within", format: (v) => `${v} mi` }),
    defaultValue: (mode, { radiusMiles }) => Math.min(1, radiusMiles),
    summary: (v) => `Within ${v} mi`,
    check: (l, v) => l.distance <= v,
  },
  {
    id: "commute",
    label: "Short commute",
    modes: ["rent", "buy"],
    hint: "Uses the travel times from the Commute box. Enter a destination there first.",
    control: () => ({ type: "range", min: 5, max: 90, step: 5, label: "At most", format: (v) => `${v} min` }),
    defaultValue: () => 30,
    summary: (v) => `Commute under ${v} min`,
    check: (l, v, { commute }) => {
      const m = commute?.byListing?.[l.id];
      return m == null ? null : m <= v;
    },
  },
  {
    id: "flood",
    label: "Low flood risk",
    modes: ["rent", "buy"],
    summary: () => "Avoid high flood risk",
    check: (l) => (l.floodRisk == null || l.floodRisk === "undetermined" ? null : l.floodRisk !== "high"),
  },
  {
    id: "schools",
    label: "Near schools",
    modes: ["rent", "buy"],
    hint: "Distance from each home to the nearest public school (federal NCES data). The assigned school can differ, and there are no quality ratings.",
    controls: [
      {
        key: "level",
        type: "select",
        min: 0,
        max: 3,
        step: 1,
        label: "School",
        options: SCHOOL_LEVEL_OPTIONS.map((o, i) => ({ value: i, label: o.label })),
      },
      { key: "miles", type: "range", min: 0.25, max: 3, step: 0.25, label: "Within", format: (v) => `${v} mi` },
    ],
    defaultValue: () => ({ level: 1, miles: 1 }),
    summary: (v) => `${SCHOOL_LEVEL_OPTIONS[v.level].short} within ${v.miles} mi`,
    check: (l, v) => {
      const d = l.schoolMiles?.[SCHOOL_LEVEL_OPTIONS[v.level].key];
      return d == null ? null : d <= v.miles;
    },
  },
  {
    id: "walkable",
    label: "Walkable",
    modes: ["rent", "buy"],
    hint: "EPA Walkability Index (1–20) for each home's neighborhood: street layout, nearby shops and transit.",
    control: () => ({
      type: "select",
      label: "At least",
      options: WALK_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    }),
    defaultValue: () => WALK_OPTIONS[0].value,
    summary: (v) => `${WALK_OPTIONS.find((o) => o.value === v)?.label || "Walkable"} or better`,
    check: (l, v) => (l.walkScore == null ? null : l.walkScore >= v),
  },
  {
    id: "crime",
    label: "Lower crime",
    modes: ["rent", "buy"],
    hint: "FBI crime rates cover a whole city or township, so this weighs the area against state and U.S. rates. It can't tell homes in the same city apart.",
    summary: () => "Below-average reported crime",
  },
  {
    id: "fresh",
    label: "Newly listed",
    modes: ["rent", "buy"],
    summary: () => "Listed in the last 2 weeks",
    check: (l) => (l.daysListed == null ? null : l.daysListed <= 14),
  },
  {
    id: "negotiate",
    label: "Room to negotiate",
    modes: ["rent", "buy"],
    summary: () => "Long listings and price cuts",
  },
  {
    id: "value",
    label: "Value per sq ft",
    modes: ["rent", "buy"],
    hint: "Compares each home's price per square foot with the median of the homes you're seeing. Homes without a listed size count as unknown.",
    control: () => ({
      type: "select",
      label: "Price per sq ft",
      options: [
        { value: 100, label: "At or below median" },
        { value: 90, label: "10% below" },
        { value: 80, label: "20% below" },
      ],
    }),
    defaultValue: () => 100,
    summary: (v) => (v === 100 ? "$/sq ft at or below median" : `$/sq ft ${100 - v}% below median`),
    check: (l, v, { medianPpsf }) =>
      !medianPpsf || !l.sqft || !l.price ? null : l.price / l.sqft <= (medianPpsf * v) / 100,
  },
];

export const PREFERENCE_BY_ID = Object.fromEntries(PREFERENCES.map((p) => [p.id, p]));

export function preferencesFor(mode) {
  return PREFERENCES.filter((p) => p.modes.includes(mode));
}

// Monthly principal and interest on a 30-year loan, plus HOA.
export function monthlyPayment(price, { down, rate }, hoaFee = 0) {
  const loan = price * (1 - down / 100);
  const r = rate / 100 / 12;
  const n = 360;
  const pi = r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
  return Math.round(pi + (hoaFee || 0));
}

function clampNumber(v, { min, max, step }) {
  if (!Number.isFinite(v)) return null;
  const clamped = Math.min(max, Math.max(min, v));
  return Math.round(clamped / step) * step;
}

// Checks priorities sent by the browser:
// { items: [{ id, value, must }], custom: [string] } → same shape, cleaned.
export function parsePreferences(raw, mode, ctx) {
  if (!raw || typeof raw !== "object") return null;
  const items = [];
  for (const item of Array.isArray(raw.items) ? raw.items.slice(0, PREFERENCES.length) : []) {
    const def = PREFERENCE_BY_ID[item?.id];
    if (!def || !def.modes.includes(mode) || items.some((i) => i.id === def.id)) continue;
    let value = null;
    if (def.controls) {
      value = {};
      for (const c of def.controls) {
        const v = clampNumber(Number(item.value?.[c.key]), c);
        if (v == null) break;
        value[c.key] = v;
      }
      if (Object.keys(value).length !== def.controls.length) continue;
    } else if (def.control) {
      const c = def.control(mode, ctx);
      value =
        c.type === "select"
          ? c.options.some((o) => o.value === item.value) ? item.value : null
          : clampNumber(Number(item.value), c);
      if (value == null) continue;
    }
    items.push({ id: def.id, value, must: Boolean(item.must) });
  }
  const custom = (Array.isArray(raw.custom) ? raw.custom : [])
    .map((c) => String(c).replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_CUSTOM);
  if (!items.length && !custom.length) return null;
  return { items, custom };
}

// For one listing: which priorities it misses, and which the data can't answer.
export function checkListing(listing, prefs, mode, ctx) {
  const misses = [];
  const unknown = [];
  for (const { id, value } of prefs?.items || []) {
    const def = PREFERENCE_BY_ID[id];
    if (!def.check) continue;
    const ok = def.check(listing, value, ctx);
    if (ok === false) misses.push(def.label);
    else if (ok == null) unknown.push(def.label);
  }
  return { misses, unknown };
}

// Plain-language list of the priorities, for the AI.
export function describePreferences(prefs, mode) {
  if (!prefs) return null;
  return {
    priorities: prefs.items.map(({ id, value, must }) => {
      const def = PREFERENCE_BY_ID[id];
      return {
        name: def.label,
        detail: def.summary(value, mode),
        importance: must ? "must have" : "nice to have",
      };
    }),
    customPriorities: prefs.custom,
  };
}
