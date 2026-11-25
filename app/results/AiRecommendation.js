"use client";

import { useEffect, useState } from "react";
import { formatFacts, formatMiles, formatPrice } from "./format";
import AiPreferences from "./AiPreferences";
import PayButton from "./Payment";

const RATING_LABELS = {
  "good deal": "Good deal",
  fair: "Fairly priced",
  overpriced: "Overpriced",
  "not enough data": "Not enough data",
};

// Runs the AI analysis on request and remembers which search it was for, so a
// radius, rent/buy, or commute change shows the result is out of date.
// `commute` is the latest commute calculation (or null), sent along so the AI
// can weigh travel times. `nearby` is the Google Places counts around the
// property (or null), which the server can't look up itself.
// `filters` limits the AI to the same bedroom counts and home types the user sees.
// `priorities` is what the user told the AI to weigh (or null).
export function useRecommendation({ position, address, mode, radiusMiles, commute, nearby, filters, priorities }) {
  const [state, setState] = useState({ status: "idle" });
  // The priorities and filters the last analysis used (for Cancel). Kept here,
  // not in the panel, so it survives the panel being hidden behind a tab.
  const [ranWith, setRanWith] = useState(null);
  // Whether a new analysis has run on this page (so the included one is used).
  const [ranNew, setRanNew] = useState(false);
  const commuteKey = commute ? `${commute.destination}|${commute.travelMode}` : "";
  const filterKeyOf = (f) => (f ? `${f.beds.join(",")}/${f.types.join(",")}` : "");
  const keyFor = (p, f) =>
    position
      ? `${mode}|${radiusMiles.toFixed(2)}|${position.lat},${position.lng}|${commuteKey}|${filterKeyOf(f)}|${JSON.stringify(p)}`
      : null;
  const searchKey = keyFor(priorities, filters);

  async function run(snapshot = null) {
    const forKey = searchKey;
    const previous = state.status === "loading" ? { status: "idle" } : state;
    const previousRanWith = ranWith;
    setRanWith(snapshot);
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
          commute,
          nearby,
          filters,
          priorities,
        }),
      });
      const body = await res.json();
      if (res.status === 402 && body.payment) {
        // Needs paying for (or the demo's limit): keep showing the last
        // analysis, and offer payment for these settings.
        setRanWith(previousRanWith);
        setState({ ...previous, payment: { ...body.payment, message: body.error, forKey } });
      } else if (!res.ok) {
        setState({ status: "error", message: body.error, forKey });
      } else {
        setState({ status: "ready", data: body, forKey });
        // A new (not saved) analysis uses up the one a search includes.
        if (body.cached === false) setRanNew(true);
      }
    } catch {
      setState({ status: "error", message: "Couldn't reach the AI. Try again.", forKey });
    }
  }

  const stale = state.status !== "idle" && state.forKey !== searchKey;
  const picks =
    state.status === "ready" && !stale ? state.data.recommendations.map((r) => r.listingId) : [];
  // Would these priorities and filters bring back the last analysis
  // (everything else unchanged)?
  const matchesLast = (p, f) => state.status !== "idle" && state.forKey === keyFor(p, f);
  // A payment asked for the current settings (it no longer applies once they change).
  const payment = state.payment?.forKey === searchKey ? state.payment : null;
  return { ...state, stale, picks, run, matchesLast, ranWith, payment, ranNew };
}

// Whether the AI panel is minimized to a bubble, remembered in this browser.
const COLLAPSED_KEY = "compd-ai-collapsed";
export function useAiCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
  }, []);
  function set(value) {
    setCollapsed(value);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {}
  }
  return [collapsed, set];
}

export default function AiRecommendation({
  ai,
  listingsById,
  mode,
  onSelect,
  canRun,
  priorities,
  prefsCtx,
  collapsed,
  onCollapse,
  filters,
  onFilters,
  filtersControl,
  locked = false,
  access = null,
  purchase = null,
}) {
  const hasResult = ai.status !== "idle";
  // Once there's a result, the priorities fold away behind a button.
  const [prefsOpen, setPrefsOpen] = useState(false);
  const { ranWith } = ai;
  const showPrefs = !hasResult || prefsOpen;
  const selectedCount = priorities.payload
    ? priorities.payload.items.length + priorities.payload.custom.length
    : 0;
  const canCancel = ai.stale && ranWith && ai.matchesLast(ranWith.payload, ranWith.filters);

  function run() {
    setPrefsOpen(false);
    ai.run({ current: priorities.current, payload: priorities.payload, filters });
  }

  function cancel() {
    priorities.replace(ranWith.current);
    onFilters(ranWith.filters);
    setPrefsOpen(false);
  }

  if (collapsed) {
    return (
      <div className="panel-section ai-section ai-section-collapsed">
        <button type="button" className="ai-bubble" onClick={() => onCollapse(false)} aria-expanded="false">
          <span className="ai-bubble-icon" aria-hidden="true">
            ✦
          </span>
          <span className="ai-bubble-text">
            <strong>AI</strong> · {bubbleStatus(ai)}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="panel-section ai-section">
      <div className="ai-head">
        <h2>AI recommendation</h2>
        <span className="ai-head-right">
          <span className="ai-badge">Claude</span>
          {onCollapse && (
            <button
              type="button"
              className="ai-minimize"
              onClick={() => onCollapse(true)}
              aria-label="Minimize the AI panel"
              title="Minimize"
            >
              –
            </button>
          )}
        </span>
      </div>

      {!hasResult && (
        <p className="panel-muted">
          Have AI judge this property against the homes in your radius and suggest better deals.
          Pick what matters to you, or skip this and analyze.
        </p>
      )}

      {showPrefs ? (
        <>
          {filtersControl && (
            <div className="ai-compare">
              <div className="ai-prefs-head">
                <h3>Homes to compare</h3>
                <span className="panel-muted">Same as the listing filters</span>
              </div>
              {filtersControl}
            </div>
          )}
          <AiPreferences priorities={priorities} mode={mode} ctx={prefsCtx} />
        </>
      ) : (
        <button type="button" className="chip ai-prefs-toggle" onClick={() => setPrefsOpen(true)}>
          Change priorities{selectedCount ? ` (${selectedCount})` : ""}
        </button>
      )}

      {locked && <p className="panel-muted">Unlock this search to analyze it with AI.</p>}

      {!locked && (ai.status === "idle" || ai.stale) && (
        <>
          {ai.stale && (
            <p className="panel-muted">
              Your priorities, homes to compare, radius, rent/buy choice, or commute changed since the last analysis.
            </p>
          )}
          {ai.payment ? (
            <div className="ai-payment">
              <p className={ai.payment.kind === "reanalysis" ? "panel-muted" : "panel-error"}>{ai.payment.message}</p>
              {ai.payment.kind === "reanalysis" && purchase && (
                <PayButton
                  purchase={{ ...purchase, kind: "reanalysis" }}
                  price={ai.payment.price}
                  onPaid={run}
                >
                  Re-analyze for
                </PayButton>
              )}
            </div>
          ) : (
            <>
              <button type="button" className="btn ai-run" onClick={run} disabled={!canRun}>
                {ai.stale ? "Re-analyze" : "Analyze with AI"}
              </button>
              <AnalysisCostNote
                access={access && { ...access, aiIncludedLeft: access.aiIncludedLeft && !ai.ranNew }}
              />
            </>
          )}
          {canCancel && (
            <button
              type="button"
              className="ai-cancel"
              onClick={cancel}
              title="Undo your changes and go back to the last analysis"
            >
              Cancel
            </button>
          )}
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
          <button type="button" className="chip" onClick={run}>
            Try again
          </button>
        </>
      )}

      {ai.status === "ready" && !ai.stale && (
        <AiResult result={ai.data} listingsById={listingsById} mode={mode} onSelect={onSelect} />
      )}
    </div>
  );
}

// One-line status for the minimized bubble.
function bubbleStatus(ai) {
  if (ai.status === "idle") return "Analyze this property";
  if (ai.stale) return "Out of date";
  if (ai.status === "loading") return "Analyzing…";
  if (ai.status === "error") return "Couldn't analyze";
  const n = ai.data.recommendations.length;
  return `${RATING_LABELS[ai.data.verdict.rating]} · ${n} ${n === 1 ? "pick" : "picks"}`;
}

function DetailList({ title, items, muted = false }) {
  if (!items?.length) return null;
  return (
    <div className={muted ? "ai-detail ai-detail-muted" : "ai-detail"}>
      <h4>{title}</h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// What the next new analysis costs, under the Analyze button. Reopening an
// analysis already run with the same settings is always free.
function AnalysisCostNote({ access }) {
  if (!access) return null;
  let text = null;
  if (access.demo) {
    text = "The standard analysis is free in the demo. With your own priorities or filters: 1 custom analysis this week.";
  } else if (access.source === "full" || access.tier === "advanced") {
    text = null;
  } else if (access.aiIncludedLeft) {
    text = "Your first analysis is included with this search.";
  } else {
    text = "New analyses cost $0.50. Reopening one you've already run is free.";
  }
  return text ? <p className="panel-muted pay-note">{text}</p> : null;
}

function AiResult({ result, listingsById, mode, onSelect }) {
  const { verdict, marketContext, recommendations, caveats, priorityNotes = [] } = result;

  return (
    <div className="ai-result">
      {/* 1. Summary */}
      <div className={`ai-verdict ai-verdict-${verdict.rating.replace(/\s+/g, "-")}`}>
        <span className="ai-verdict-label">This property: {RATING_LABELS[verdict.rating]}</span>
        <p>{verdict.summary}</p>
      </div>

      {/* 2. Recommended homes */}
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

      {/* 3. The details behind the verdict */}
      <div className="ai-details">
        <h3 className="ai-picks-title">Details</h3>
        <DetailList title="About this property" items={verdict.factors} />
        <DetailList title="Market" items={marketContext ? [marketContext] : []} />
        <DetailList
          title="Your priorities"
          items={priorityNotes.map((n) => (
            <>
              <strong>{n.priority}:</strong> {n.note}
            </>
          ))}
        />
        <DetailList title="Keep in mind" items={caveats} muted />
      </div>
      <p className="panel-credit">
        AI-generated from listing data — a starting point, not financial advice.
      </p>
    </div>
  );
}
