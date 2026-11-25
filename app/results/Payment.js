"use client";

import { useEffect, useState } from "react";

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
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
export default function PayButton({ purchase, price, onPaid, children }) {
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
          <p>
            Charge <strong>{dollars(price)}</strong> to {cardLabel(card)}?
          </p>
          <div className="pay-actions">
            <button type="button" className="btn btn-small" onClick={pay}>
              Confirm {dollars(price)}
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
          You&apos;ll pay on Stripe&apos;s secure page. Your card is saved with Stripe so next time it&apos;s one click.
        </p>
      )}
      {error && <p className="panel-error">{error}</p>}
    </div>
  );
}

// Shown in place of a search's results until it's unlocked.
export function SearchPaywall({ comps, purchase }) {
  return (
    <div className="paywall">
      <p className="paywall-title">{comps.message || "Unlock this search to see its homes."}</p>
      <ul className="paywall-list">
        <li>Every home for {purchase.mode === "buy" ? "sale" : "rent"} in your radius, for 7 days</li>
        <li>1 AI analysis (more for $0.50 each)</li>
        <li>3 commute checks</li>
      </ul>
      <PayButton purchase={{ ...purchase, kind: "search" }} price={comps.payment.price} onPaid={comps.reload}>
        Unlock
      </PayButton>
      <p className="panel-muted paywall-plans">
        Searching a lot? <a href="/api/checkout?plan=basic">Basic $10/mo</a> includes 6 searches, or{" "}
        <a href="/api/checkout?plan=advanced">Unlimited $25/mo</a>.
      </p>
    </div>
  );
}
