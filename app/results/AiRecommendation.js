"use client";

import { useEffect, useState } from "react";
import { formatFacts, formatMiles, formatPrice } from "./format";
import AiPreferences from "./AiPreferences";
import PayButton, { HoldNotice } from "./Payment";
import { featuresFor, sourceName } from "./amenities";
import { CREDIT_COST, dollars, REANALYSIS_PRICE, TAB_HOLD } from "../../lib/prices";


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
  // Which search this is, for loading earlier analyses of it.
  const where = position ? { lat: position.lat, lng: position.lng, mode } : null;
  return { ...state, stale, picks, run, matchesLast, ranWith, payment, ranNew, where };
}

// The user's earlier analyses of this search (address and rent/buy), newest
// first, reloaded after each new one. `exclude`: the analysis shown above.
function usePastAnalyses(where, latestKey) {
  const [list, setList] = useState([]);
  const whereKey = where ? `${where.lat},${where.lng},${where.mode}` : null;
  useEffect(() => {
    if (!where) return;
    let cancelled = false;
    fetch(`/api/analyses?${new URLSearchParams({ lat: where.lat, lng: where.lng, mode: where.mode })}`)
      .then((r) => (r.ok ? r.json() : { analyses: [] }))
      .then((b) => !cancelled && setList(b.analyses || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereKey, latestKey]);
  return list;
}

const whenLabel = (d) =>
  new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Earlier analyses as small cards; each opens to the full result as it was.
function PastAnalyses({ ai, mode, listingsById, onSelect, hidden = null }) {
  const showing = ai.status === "ready" && !ai.stale ? ai.data.analysisKey : null;
  const list = usePastAnalyses(ai.where, ai.status === "ready" ? ai.data.analysisKey : null).filter(
    (a) => a.analysisKey !== showing
  );
  if (!list.length) return null;
  return (
    <div className="past-analyses">
      <h3>Earlier analyses</h3>
      <ul>
        {list.map((a) => {
          // The picks as they were when this ran (homes may have changed or gone since).
          const saved = new Map((a.result.pickListings || []).map((l) => [l.id, l]));
          const lookup = { get: (id) => saved.get(id) || listingsById.get(id) };
          return (
            <li key={a.id}>
              <details className="past-analysis">
                <summary>
                  <span className={`past-rating past-${a.result.verdict.rating.replace(/\s+/g, "-")}`}>
                    {RATING_LABELS[a.result.verdict.rating]}
                  </span>
                  <span className="past-label">{a.label}</span>
                  <span className="past-open" aria-hidden="true">
                    ▸
                  </span>
                  <span className="past-meta">
                    {whenLabel(a.createdAt)} · {formatMiles(a.radiusMiles)} · {a.result.recommendations.length}{" "}
                    {a.result.recommendations.length === 1 ? "pick" : "picks"}
                  </span>
                </summary>
                <AiResult result={a.result} listingsById={lookup} mode={mode} onSelect={onSelect} hidden={hidden} />
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
  // "Not for me": for the user's own searches (the shared demo doesn't use it).
  const canHide = !locked && Boolean(access) && !access.demo;
  const hiddenState = useHidden(mode, canHide);
  const hidden = canHide ? hiddenState : null;

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
        <h2>AI analysis</h2>
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
        <AiResult result={ai.data} listingsById={listingsById} mode={mode} onSelect={onSelect} hidden={hidden} />
      )}

      {!locked && (
        <PastAnalyses ai={ai} mode={mode} listingsById={listingsById} onSelect={onSelect} hidden={hidden} />
      )}
      {canHide && <HiddenHomes hidden={hidden} />}
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
        : `Re-analyses use ${CREDIT_COST.reanalysis} credits: ${left} of ${c.max} left. Reopening one you've already run is free.`;
  } else if (access.tab) {
    const closes = new Date(access.tab.closesAt).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    text = (
      <>
        Re-analyses add <strong>+{dollars(REANALYSIS_PRICE)}</strong> to your tab: <strong>{dollars(access.tab.usedCents)}</strong> of{" "}
        {dollars(access.tab.holdCents)} so far, charged {closes} (when the hold lifts). Reopening one you&apos;ve
        already run is free.
      </>
    );
  } else {
    text = (
      <>
        Re-analyses are <strong>+{dollars(REANALYSIS_PRICE)}</strong> each, on a {dollars(TAB_HOLD)} hold that&apos;s
        charged once for what you use.
        Reopening one you&apos;ve already run is free.
      </>
    );
  }
  return text ? <p className="panel-muted pay-note">{text}</p> : null;
}

// Steps shown while the analysis runs. The AI checks listing pages on the web
// (still available? facts right?); for rentals it also looks up amenities, and
// with the user's own priorities it looks those up too.
const LOADING_STEPS = {
  rent: [
    "Comparing rents in your radius…",
    "Picking the strongest candidates…",
    "Checking each listing is still available…",
    "Searching listings for laundry, A/C and parking…",
    "Checking which utilities are included…",
    "Reading property manager pages…",
    "Weighing what it found against your priorities…",
    "Writing up the picks…",
  ],
  buy: [
    "Comparing homes in your radius…",
    "Picking the strongest candidates…",
    "Checking each home is still for sale…",
    "Checking listing pages match the data…",
    "Weighing what it found against your priorities…",
    "Writing up the picks…",
  ],
  buyCustom: [
    "Comparing homes in your radius…",
    "Picking the strongest candidates…",
    "Checking each home is still for sale…",
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
              : "This takes about a minute: the AI checks each listing page."}{" "}
          {seconds >= 5 && `${seconds}s`}
        </p>
      </div>
    </div>
  );
}

const STATUS_MARK = { yes: "✓", no: "✗", unknown: "?" };

const chipText = (s) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);

// What the AI found on the web about one home: whether it's still available,
// its amenities (rentals), and the user's own priorities. A row of chips, and
// a collapsed list with each detail and the pages it came from.
function AmenityList({ amenities, custom, mode }) {
  const items = [
    ...(amenities?.features ? featuresFor(mode).map((f) => ({ ...f, ...amenities.features[f.key] })) : []),
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
    const lookedUp = mode === "buy" ? "whether it's still for sale" : "availability, laundry, utilities, parking and pets";
    const what = [amenities?.features && lookedUp, customText]
      .filter(Boolean)
      .join(" and ");
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

// "Not for me" under a pick: opens a short box for the reason, then hides it.
const MAX_REASON = 160;
function NotForMe({ listing, onHide }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button type="button" className="not-for-me" onClick={() => setOpen(true)}>
        ✕ Not for me
      </button>
    );
  }
  return (
    <form
      className="not-for-me-form"
      onSubmit={(e) => {
        e.preventDefault();
        onHide(reason.trim());
      }}
    >
      <label htmlFor={`why-${listing.id}`}>What don&apos;t you like about it? (optional)</label>
      <input
        id={`why-${listing.id}`}
        type="text"
        value={reason}
        maxLength={MAX_REASON}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. too far from campus, no dishwasher"
        autoFocus
      />
      <p className="panel-muted">
        Future analyses will skip this home, and the AI will keep your reason in mind for others.
      </p>
      <div className="pay-actions">
        <button type="submit" className="btn btn-small">
          Hide this home
        </button>
        <button type="button" className="pref-remove" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// The user's hidden homes for renting or buying, with hide and undo.
export function useHidden(mode, enabled = true) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/hidden?mode=${mode}`)
      .then((r) => (r.ok ? r.json() : { hidden: [] }))
      .then((b) => !cancelled && setList(b.hidden || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, enabled]);

  async function hide(listing, reason) {
    const entry = { listingId: listing.id, address: listing.address, reason, createdAt: new Date().toISOString() };
    setList((l) => [entry, ...l.filter((h) => h.listingId !== listing.id)]);
    await fetch("/api/hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: listing.id, address: listing.address, mode, reason }),
    }).catch(() => {});
  }
  async function unhide(listingId) {
    setList((l) => l.filter((h) => h.listingId !== listingId));
    await fetch(`/api/hidden?${new URLSearchParams({ listingId, mode })}`, { method: "DELETE" }).catch(() => {});
  }
  return { list, ids: new Set(list.map((h) => h.listingId)), hide, unhide };
}

// "Homes you hid (3)": each with its reason and Undo.
function HiddenHomes({ hidden }) {
  if (!hidden?.list.length) return null;
  return (
    <details className="hidden-homes">
      <summary>Homes you hid ({hidden.list.length})</summary>
      <p className="panel-muted">Analyses skip these. Your reasons help the AI pick homes you&apos;ll like.</p>
      <ul>
        {hidden.list.map((h) => (
          <li key={h.listingId}>
            <span>
              <strong>{h.address.split(",")[0]}</strong>
              {h.reason && <span className="panel-muted"> · “{h.reason}”</span>}
            </span>
            <button type="button" className="pref-link" onClick={() => hidden.unhide(h.listingId)}>
              Undo
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function AiResult({ result, listingsById, mode, onSelect, hidden = null }) {
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
          if (hidden?.ids.has(r.listingId)) {
            return (
              <li key={r.listingId} className="ai-pick-hidden">
                <span>
                  <strong>{formatPrice(l.price, mode)}</strong> · hidden. Future analyses will skip it.
                </span>
                <button type="button" className="pref-link" onClick={() => hidden.unhide(r.listingId)}>
                  Undo
                </button>
              </li>
            );
          }
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
              {r.corrections?.length > 0 && (
                <ul className="ai-corrections">
                  {r.corrections.map((c) => (
                    <li key={`${c.field}|${c.pageValue}`}>
                      ⚠ Listing page: <strong>{c.pageValue}</strong> (data said {c.dataValue})
                      {c.source && (
                        <>
                          {" · "}
                          <a href={c.source} target="_blank" rel="noopener noreferrer nofollow">
                            {sourceName(c.source)}
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <AmenityList
                amenities={amenities?.byListing?.[r.listingId]}
                custom={customFindings?.byListing?.[r.listingId]}
                mode={mode}
              />
              {hidden && <NotForMe listing={l} onHide={(reason) => hidden.hide(l, reason)} />}
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
