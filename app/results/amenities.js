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

// Checks an amenity record (from the AI or the database) for shape.
// -> { features: { key: { status, detail } }, sources: [url] } or null.
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
  return { features, sources };
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
