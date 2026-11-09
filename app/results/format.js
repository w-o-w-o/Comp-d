const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatPrice(amount, mode) {
  if (amount == null) return "—";
  return mode === "rent" ? `${dollars.format(amount)}/mo` : dollars.format(amount);
}

// Compact label for map pins: $2.1k, $650k, $1.2M
export function formatShortPrice(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (amount >= 10_000) return `$${Math.round(amount / 1000)}k`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${amount}`;
}

export function formatMiles(miles) {
  return `${Math.round(miles * 10) / 10} mi`;
}

// "3 bd · 2 ba · 1,450 sqft"
export function formatFacts({ beds, baths, sqft }) {
  const parts = [];
  if (beds != null) parts.push(beds === 0 ? "Studio" : `${beds} bd`);
  if (baths != null) parts.push(`${baths} ba`);
  if (sqft) parts.push(`${sqft.toLocaleString("en-US")} sqft`);
  return parts.join(" · ");
}
