// Rental amenities the AI looks up on the web (they aren't in the listing
// data). Shared by the page, the priorities, and the server.

export const AMENITY_FEATURES = [
  { key: "laundry", label: "In-unit laundry", short: "Laundry" },
  { key: "airConditioning", label: "Air conditioning", short: "A/C" },
  { key: "heatIncluded", label: "Heat included", short: "Heat incl." },
  { key: "waterIncluded", label: "Water included", short: "Water incl." },
  { key: "internetIncluded", label: "Wi-Fi / internet included", short: "Wi-Fi incl." },
  { key: "parking", label: "Parking", short: "Parking" },
  { key: "pets", label: "Pets allowed", short: "Pets" },
];

export const AMENITY_STATUSES = ["yes", "no", "unknown"];

// Same address written slightly differently -> same key.
export function addressKey(address = "") {
  return String(address)
    .toLowerCase()
    .replace(/,?\s*usa$/, "")
    .replace(/[.#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FACT_FIELDS = ["bedrooms", "bathrooms", "price", "size", "kind", "unavailable"];
const httpUrl = (s) => (/^https?:\/\/[^\s"<>]+$/i.test(String(s || "").trim()) ? String(s).trim() : null);

// Facts the home's listing page showed differently from the listing data
// (for example 4 bedrooms where the data says 2), checked for shape.
export function cleanFacts(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((f) => FACT_FIELDS.includes(f?.field))
    .slice(0, 6)
    .map((f) => ({
      field: f.field,
      dataValue: String(f.dataValue || "").slice(0, 80),
      pageValue: String(f.pageValue || "").slice(0, 80),
      bedroomsOnPage: Number.isFinite(f.bedroomsOnPage) ? f.bedroomsOnPage : null,
      source: httpUrl(f.source),
    }));
}

// Checks an amenity record (from the AI or the database) for shape.
// -> { features: { key: { status, detail } }, sources: [url], facts } or null.
export function cleanAmenities(raw) {
  if (!raw || typeof raw !== "object") return null;
  const features = {};
  for (const { key } of AMENITY_FEATURES) {
    const f = raw.features?.[key] ?? raw[key];
    const status = AMENITY_STATUSES.includes(f?.status) ? f.status : "unknown";
    features[key] = { status, detail: String(f?.detail || "").slice(0, 200) };
  }
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .map((s) => String(s).trim())
    .filter((s) => /^https?:\/\/[^\s"<>]+$/i.test(s))
    .slice(0, 4);
  // factsChecked: the listing page's facts (beds, price…) were checked too.
  return { features, sources, facts: cleanFacts(raw.facts), factsChecked: Boolean(raw.factsChecked) };
}

// Does this record say anything at all?
export const hasAnyAnswer = (a) => Boolean(a && Object.values(a.features).some((f) => f.status !== "unknown"));

// "https://www.apartments.com/3736-orin..." -> "apartments.com"
export function sourceName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
