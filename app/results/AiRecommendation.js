"use client";

import { useState } from "react";
import { formatFacts, formatMiles, formatPrice } from "./format";

const RATING_LABELS = {
  "good deal": "Good deal",
  fair: "Fairly priced",
  overpriced: "Overpriced",
  "not enough data": "Not enough data",
};

// Runs the AI analysis on request and remembers which search it was for, so a
// radius or rent/buy change shows the result is out of date.
export function useRecommendation({ position, address, mode, radiusMiles }) {
  const [state, setState] = useState({ status: "idle" });
  const searchKey = position
    ? `${mode}|${radiusMiles.toFixed(2)}|${position.lat},${position.lng}`
    : null;

  async function run() {
    const forKey = searchKey;
    setState({ status: "loading", forKey });
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: position.lat,
          lng: position.lng,
          radiusMiles,
          mode,
          address,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error, upgradeTo: body.upgradeTo, forKey });
      } else {
        setState({ status: "ready", data: body, forKey });
      }
    } catch {
      setState({ status: "error", message: "Couldn't reach the AI. Try again.", forKey });
    }
  }

  const stale = state.status !== "idle" && state.forKey !== searchKey;
  const picks =
    state.status === "ready" && !stale ? state.data.recommendations.map((r) => r.listingId) : [];
  return { ...state, stale, picks, run };
}

export default function AiRecommendation({ ai, listingsById, mode, onSelect, canRun }) {
  return (
    <div className="panel-section ai-section">
      <div className="ai-head">
        <h2>AI recommendation</h2>
        <span className="ai-badge">Claude</span>
      </div>

      {(ai.status === "idle" || ai.stale) && (
        <>
          <p className="panel-muted">
            {ai.stale
              ? "Your radius or rent/buy choice changed since the last analysis."
              : "Have AI judge this property against the homes in your radius and suggest better deals."}
          </p>
          <button type="button" className="btn ai-run" onClick={ai.run} disabled={!canRun}>
            {ai.stale ? "Re-analyze" : "Analyze with AI"}
          </button>
        </>
      )}

      {ai.status === "loading" && !ai.stale && (
        <p className="panel-muted ai-loading">
          Comparing homes in your radius… this can take up to a minute.
        </p>
      )}

      {ai.status === "error" && !ai.stale && (
        <>
          <p className="panel-error">{ai.message}</p>
          {ai.upgradeTo ? (
            <UpgradeButton tier={ai.upgradeTo} />
          ) : (
            <button type="button" className="chip" onClick={ai.run}>
              Try again
            </button>
          )}
        </>
      )}

      {ai.status === "ready" && !ai.stale && (
        <AiResult result={ai.data} listingsById={listingsById} mode={mode} onSelect={onSelect} />
      )}
    </div>
  );
}

// Plain <a>: checkout is a server redirect to Stripe, not a page.
export function UpgradeButton({ tier }) {
  const label = tier === "advanced" ? "Upgrade to Advanced — $20/mo" : "Upgrade to Basic — $10/mo";
  return (
    <a href={`/api/checkout?plan=${tier}`} className="btn upgrade-btn">
      {label}
    </a>
  );
}

function AiResult({ result, listingsById, mode, onSelect }) {
  const { verdict, recommendations, caveats } = result;

  return (
    <div className="ai-result">
      <div className={`ai-verdict ai-verdict-${verdict.rating.replace(/\s+/g, "-")}`}>
        <span className="ai-verdict-label">This property: {RATING_LABELS[verdict.rating]}</span>
        <p>{verdict.summary}</p>
        {verdict.factors.length > 0 && (
          <ul>
            {verdict.factors.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="ai-picks-title">
        {recommendations.length > 0
          ? `${recommendations.length} possibly better ${recommendations.length === 1 ? "deal" : "deals"}`
          : "No clearly better deals in this radius"}
      </h3>
      <ol className="ai-picks">
        {recommendations.map((r) => {
          const l = listingsById.get(r.listingId);
          if (!l) return null;
          return (
            <li key={r.listingId}>
              <button type="button" className="ai-pick" onClick={() => onSelect(r.listingId)}>
                <span className="ai-pick-head">
                  <strong>{formatPrice(l.price, mode)}</strong>
                  <span className="listing-facts">
                    {[formatFacts(l), `${formatMiles(l.distance)} away`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="ai-pick-headline">{r.headline}</span>
                <ul>
                  {r.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {r.tradeoff && <span className="ai-tradeoff">Trade-off: {r.tradeoff}</span>}
              </button>
            </li>
          );
        })}
      </ol>

      {caveats.length > 0 && (
        <p className="panel-muted ai-caveats">Note: {caveats.join(" ")}</p>
      )}
      <p className="panel-credit">
        AI-generated from listing data — a starting point, not financial advice.
      </p>
    </div>
  );
}
