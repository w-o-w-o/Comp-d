"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMiles, formatPrice } from "../results/format";

function timeAgo(date) {
  const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function expiresIn(date) {
  const hours = (new Date(date).getTime() - Date.now()) / 3_600_000;
  if (hours < 24) return "Expires today";
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

// Saved searches with buttons to reopen or remove each one.
// `entries` come from the server with an `href` that reopens the results.
export default function HistoryList({ entries: initial, compact = false }) {
  const [entries, setEntries] = useState(initial);
  const [error, setError] = useState(null);

  async function remove(id) {
    const before = entries;
    setEntries((list) => list.filter((e) => e.id !== id));
    setError(null);
    const res = await fetch(`/api/history?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setEntries(before);
      setError("Couldn't remove that search. Try again.");
    }
  }

  if (entries.length === 0) {
    return (
      <p className="panel-muted">
        No saved searches yet. Every address you search is saved here automatically for 7 days, while
        its listing data is current.
      </p>
    );
  }

  return (
    <>
      {error && <p className="panel-error">{error}</p>}
      <ul className={compact ? "history-list history-compact" : "history-list"}>
        {entries.map((e) => (
          <li key={e.id} className="history-item">
            <Link href={e.href} className="history-open">
              <span className="history-address">{e.formatted_address || e.address}</span>
              <span className="history-meta">
                <span className={`history-mode history-mode-${e.mode}`}>
                  {e.mode === "buy" ? "Buying" : "Renting"}
                </span>
                <span>{formatMiles(e.radius_miles)} radius</span>
                {e.listing_count != null && (
                  <span>
                    {e.listing_count} {e.listing_count === 1 ? "home" : "homes"}
                  </span>
                )}
                {!compact && e.estimate_amount != null && (
                  <span>Est. {formatPrice(e.estimate_amount, e.mode)}</span>
                )}
                <span>{timeAgo(e.last_viewed_at)}</span>
                <span className="history-expires" title="Listing data is refreshed after 7 days, so the search is removed then">
                  {expiresIn(e.expires_at)}
                </span>
              </span>
            </Link>
            <button
              type="button"
              className="history-remove"
              onClick={() => remove(e.id)}
              aria-label={`Remove ${e.formatted_address || e.address} from history`}
              title="Remove from history"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
