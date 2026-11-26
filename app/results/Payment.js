"use client";

import { useEffect, useState } from "react";
import { dollars, REANALYSIS_PRICE, TAB_HOLD, TAB_HOURS } from "../../lib/prices";

const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };
const cardLabel = (c) => `${BRANDS[c.brand] || c.brand} •••• ${c.last4}`;

// The user's saved card (from Stripe) and prices, loaded once per page.
let infoPromise = null;
export function usePaymentInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    infoPromise ??= fetch("/api/purchase")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    let cancelled = false;
    infoPromise.then((i) => !cancelled && setInfo(i));
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

// A pay button that always asks before charging. With a saved card it charges
// it right here; otherwise (or if the bank wants confirmation) it opens
// Stripe's checkout page, which saves the card for next time.
// `purchase`: { kind, lat, lng, mode, label, returnTo }.
// How the $5 hold works, in bold where it matters. Shown wherever someone is
// about to start a tab. `search`: the search price when this payment unlocks
// a search; `tab`: the open tab ({ usedCents, holdCents }), if any.
export function HoldNotice({ hold, each, search = null, tab = null }) {
  return (
    <div className="hold-notice" role="note">
      <p className="hold-notice-head">
        <strong>{dollars(hold)} hold</strong> · you&apos;re only charged for what you use
      </p>
      <ul>
        {search != null && (
          <li>
            <strong>{dollars(search)}</strong> for this search and its first AI analysis
          </li>
        )}
        <li>
          <strong>+{dollars(each)}</strong> for every re-analysis{search != null ? " after that" : ""}
        </li>
        <li>
          The hold lifts after <strong>{TAB_HOURS} hours</strong>, and you&apos;re charged once for what you used. Use up the{" "}
          {dollars(hold)} and a new {dollars(hold)} hold starts.
        </li>
      </ul>
      {tab && (
        <p className="hold-notice-tab">
          Your tab so far: <strong>{dollars(tab.usedCents)}</strong> of {dollars(tab.holdCents)}.
        </p>
      )}
    </div>
  );
}

// What the confirm step says for a tab payment (`hold`: { amount, search, tab }).
function holdQuestion(hold, card) {
  const on = <>on {cardLabel(card)}</>;
  if (hold.search != null && hold.tab && hold.tab.holdCents - hold.tab.usedCents >= hold.search) {
    return (
      <>
        Add <strong>{dollars(hold.search)}</strong> to your tab {on}? It&apos;s charged with the rest when the tab
        closes.
      </>
    );
  }
  if (hold.search != null && hold.tab) {
    return (
      <>
        Your tab ({dollars(hold.tab.usedCents)}) is charged now, and a new <strong>{dollars(hold.amount)} hold</strong>{" "}
        starts {on} with this search ({dollars(hold.search)}) on it. OK?
      </>
    );
  }
  return (
    <>
      Place a <strong>{dollars(hold.amount)} hold</strong> {on}? You&apos;re only charged for what you use.
    </>
  );
}

// `hold` ({ amount, search?, tab? }): this payment goes on a tab (a hold), not a
// direct charge; `price` is what the button shows.
export default function PayButton({ purchase, price, onPaid, hold = null, children }) {
  const info = usePaymentInfo();
  const [step, setStep] = useState("idle"); // idle | confirm | paying
  const [error, setError] = useState(null);
  const card = info?.card;

  async function pay() {
    setStep("paying");
    setError(null);
    try {
      const res = await fetch("/api/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...purchase, useSavedCard: Boolean(card) }),
      });
      const body = await res.json();
      if (body.ok) {
        setStep("idle");
        onPaid();
        return;
      }
      if (body.checkoutUrl) {
        window.location.href = body.checkoutUrl;
        return;
      }
      setError(body.error || "Payment didn't go through.");
    } catch {
      setError("Couldn't reach the payment service. Try again.");
    }
    setStep("idle");
  }

  if (info && info.available === false) {
    return <p className="panel-muted">Payments aren&apos;t set up on this server yet.</p>;
  }

  return (
    <div className="pay">
      {step === "confirm" ? (
        <div className="pay-confirm">
          {hold ? (
            <p>{holdQuestion(hold, card)}</p>
          ) : (
            <p>
              Charge <strong>{dollars(price)}</strong> to {cardLabel(card)}?
            </p>
          )}
          <div className="pay-actions">
            <button type="button" className="btn btn-small" onClick={pay}>
              Confirm
            </button>
            <button type="button" className="pref-remove" onClick={() => setStep("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn pay-btn"
          disabled={!info || step === "paying"}
          onClick={() => (card ? setStep("confirm") : pay())}
        >
          {step === "paying"
            ? "Processing…"
            : card
              ? `${children || "Pay"} ${dollars(price)} · ${cardLabel(card)}`
              : `${children || "Pay"} ${dollars(price)}`}
        </button>
      )}
      {!card && info && step !== "confirm" && (
        <p className="panel-muted pay-note">
          {hold
            ? `You'll confirm the ${dollars(hold.amount)} hold on Stripe's secure page. `
            : "You'll pay on Stripe's secure page. "}
          Your card is saved with Stripe so next time it&apos;s one click.
        </p>
      )}
      {error && <p className="panel-error">{error}</p>}
    </div>
  );
}

// Shown in place of a search's results until it's unlocked.
export function SearchPaywall({ comps, purchase }) {
  const { price, hold = TAB_HOLD, each = REANALYSIS_PRICE, tab = null } = comps.payment;
  return (
    <div className="paywall">
      <p className="paywall-title">{comps.message || "Unlock this search to see its homes."}</p>
      <ul className="paywall-list">
        <li>Every home for {purchase.mode === "buy" ? "sale" : "rent"} in your radius, for 7 days</li>
        <li>1 AI analysis included</li>
        <li>Commute checks to work, school, or anywhere you go</li>
      </ul>
      <HoldNotice hold={hold} each={each} search={price} tab={tab} />
      <PayButton
        purchase={{ ...purchase, kind: "search" }}
        price={price}
        hold={{ amount: hold, search: price, tab }}
        onPaid={comps.reload}
      >
        Unlock
      </PayButton>
      <p className="panel-muted paywall-plans">
        Searching a lot? <a href="/api/checkout?plan=basic">Basic $15/mo</a> includes 50 credits (up to 10 searches,
        or fewer searches and more re-analyses), or{" "}
        <a href="/api/checkout?plan=advanced">Pro $29/mo</a> includes 150.{" "}
        <a href="/refunds" target="_blank" rel="noopener">Refund policy</a>
      </p>
    </div>
  );
}
