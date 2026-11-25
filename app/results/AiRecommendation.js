"use client";

import { useEffect, useState } from "react";
import { formatFacts, formatMiles, formatPrice } from "./format";
import AiPreferences from "./AiPreferences";
import PayButton, { HoldNotice } from "./Payment";
import { AMENITY_FEATURES, sourceName } from "./amenities";

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

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
              {ai.payment.message && (
                <p className={["reanalysis", "tab"].includes(ai.payment.kind) ? "panel-muted" : "panel-error"}>
                  {ai.payment.message}
                </p>
              )}
              {ai.payment.kind === "reanalysis" && purchase && (
                <PayButton
                  purchase={{ ...purchase, kind: "reanalysis" }}
                  price={ai.payment.price}
                  onPaid={run}
                >
                  Re-analyze for
                </PayButton>
              )}
              {ai.payment.kind === "tab" && purchase && (
                <>
                  <HoldNotice hold={ai.payment.price} each={ai.payment.each} />
                  <PayButton
                    purchase={{ ...purchase, kind: "tab" }}
                    price={ai.payment.each}
                    hold={{ amount: ai.payment.price }}
                    onPaid={run}
                  >
                    Re-analyze
                  </PayButton>
                </>
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
        <LoadingMessage mode={mode} custom={ranWith?.payload?.custom?.length > 0} />
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
  } else if (access.source === "full") {
    text = null;
  } else if (access.aiIncludedLeft) {
    text = "Your first analysis is included with this search.";
  } else if (access.usage?.credits && access.usage.credits.max > access.usage.credits.used) {
    // Basic and Pro: re-analyses come out of the plan's credits.
    const c = access.usage.credits;
    const left = c.max - c.used;
    text =
      left === 1
        ? "Your next re-analysis uses your last credit. Reopening one you've already run is free."
        : `Re-analyses use 2 credits: ${left} of ${c.max} left. Reopening one you've already run is free.`;
  } else if (access.tab) {
    const closes = new Date(access.tab.closesAt).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    text = (
      <>
        Re-analyses add <strong>+$0.50</strong> to your tab: <strong>{dollars(access.tab.usedCents)}</strong> of{" "}
        {dollars(access.tab.holdCents)} so far, charged {closes} (when the hold lifts). Reopening one you&apos;ve
        already run is free.
      </>
    );
  } else {
    text = (
      <>
        Re-analyses are <strong>+$0.50</strong> each, on a $5 hold that&apos;s charged once for what you use.
        Reopening one you&apos;ve already run is free.
      </>
    );
  }
  return text ? <p className="panel-muted pay-note">{text}</p> : null;
}

// Steps shown while the analysis runs. Rentals take longer: the AI also looks
// up amenities on the web. With the user's own priorities it looks those up
// too (rent or buy).
const LOADING_STEPS = {
  rent: [
    "Comparing rents in your radius…",
    "Picking the strongest candidates…",
    "Searching listings for laundry, A/C and parking…",
    "Checking which utilities are included…",
    "Reading property manager pages…",
    "Weighing what it found against your priorities…",
    "Writing up the picks…",
  ],
  buy: ["Comparing homes in your radius…", "Checking prices per square foot…", "Weighing your priorities…", "Writing up the picks…"],
  buyCustom: [
    "Comparing homes in your radius…",
    "Picking the strongest candidates…",
    "Looking up your own priorities on listing pages…",
    "Reading home details and descriptions…",
    "Weighing what it found against your priorities…",
    "Writing up the picks…",
  ],
};

function LoadingMessage({ mode, custom = false }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const steps =
    mode === "rent"
      ? custom
        ? [...LOADING_STEPS.rent.slice(0, 4), "Looking up your own priorities…", ...LOADING_STEPS.rent.slice(4)]
        : LOADING_STEPS.rent
      : custom
        ? LOADING_STEPS.buyCustom
        : LOADING_STEPS.buy;
  // Move on every 12 seconds, then stay on the last step.
  const step = steps[Math.min(steps.length - 1, Math.floor(seconds / 12))];
  return (
    <div className="ai-loading" role="status">
      <span className="ai-spinner" aria-hidden="true" />
      <div>
        <p>{step}</p>
        <p className="panel-muted">
          {mode === "rent"
            ? "Rentals take 1–3 minutes: the AI checks listing pages for amenities."
            : custom
              ? "This takes 1–2 minutes: the AI checks listing pages for your own priorities."
              : "This usually takes under a minute."}{" "}
          {seconds >= 5 && `${seconds}s`}
        </p>
      </div>
    </div>
  );
}

const STATUS_MARK = { yes: "✓", no: "✗", unknown: "?" };

const chipText = (s) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);

// What the AI found on the web about one home: its amenities (rentals) and
// the user's own priorities. A row of chips, and a collapsed list with each
// detail and the pages it came from.
function AmenityList({ amenities, custom, mode }) {
  const items = [
    ...(amenities?.features ? AMENITY_FEATURES.map((f) => ({ ...f, ...amenities.features[f.key] })) : []),
    ...(custom?.items || []).map((c) => ({
      key: `custom:${c.priority}`,
      label: c.priority,
      short: chipText(c.priority),
      status: c.status,
      detail: c.detail,
    })),
  ];
  if (!items.length) return null;
  const found = items.filter((f) => f.status !== "unknown");
  if (!found.length) {
    // "Garage and fenced yard: not found online."
    const names = (custom?.items || []).map((c) => c.priority);
    const customText = names.length > 3 ? "your own priorities" : names.join(names.length === 2 ? " and " : ", ");
    const what = [amenities?.features && "Laundry, utilities, parking and pets", customText].filter(Boolean).join(" and ");
    return (
      <p className="panel-muted amenity-none">
        {what.charAt(0).toUpperCase() + what.slice(1)}: not found online.
      </p>
    );
  }
  const sources = [...new Set([...(amenities?.sources || []), ...(custom?.sources || [])])].slice(0, 6);
  return (
    <div className="amenities">
      <ul className="amenity-chips">
        {items.map((f) => (
          <li key={f.key} className={`amenity-chip amenity-${f.status}`} title={f.detail || "Not found"}>
            <span aria-hidden="true">{STATUS_MARK[f.status]}</span> {f.short}
            <span className="sr-only">: {f.status === "unknown" ? "not found" : f.status}</span>
          </li>
        ))}
      </ul>
      <details className="amenity-details">
        <summary>
          Details and sources ({found.length} of {items.length} found)
        </summary>
        <ul>
          {items.map((f) => (
            <li key={f.key}>
              <strong>{f.label}:</strong> {f.status === "unknown" ? "not found" : f.detail || f.status}
            </li>
          ))}
        </ul>
        {sources.length > 0 && (
          <p className="amenity-sources">
            From{" "}
            {sources.map((url, i) => (
              <span key={url}>
                {i > 0 && ", "}
                <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                  {sourceName(url)}
                </a>
              </span>
            ))}
            . {mode === "buy" ? "Confirm with the listing agent." : "Check with the landlord before you sign."}
          </p>
        )}
      </details>
    </div>
  );
}

function AiResult({ result, listingsById, mode, onSelect }) {
  const { verdict, marketContext, recommendations, caveats, priorityNotes = [], amenities, customFindings } = result;

  return (
    <div className="ai-result">
      {/* 1. Summary */}
      <div className={`ai-verdict ai-verdict-${verdict.rating.replace(/\s+/g, "-")}`}>
        <span className="ai-verdict-label">This property: {RATING_LABELS[verdict.rating]}</span>
        <p>{verdict.summary}</p>
        <AmenityList amenities={amenities?.subject} custom={customFindings?.subject} mode={mode} />
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
              <AmenityList
                amenities={amenities?.byListing?.[r.listingId]}
                custom={customFindings?.byListing?.[r.listingId]}
                mode={mode}
              />
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
