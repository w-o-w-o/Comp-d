"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Cancel plan (with a confirm step), or Keep my plan once it's set to end.
// `endsOn`: the formatted end of the paid period; `canceling`: already set to end.
export default function PlanCancel({ planName, endsOn, canceling }) {
  const router = useRouter();
  const [step, setStep] = useState("idle"); // idle | confirm | working
  const [error, setError] = useState(null);

  async function send(action) {
    setStep("working");
    setError(null);
    try {
      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error);
      setStep("idle");
      router.refresh();
    } catch (err) {
      setError(err.message || "Couldn't update your plan. Try again.");
      setStep("idle");
    }
  }

  if (canceling) {
    return (
      <div className="plan-cancel">
        <button type="button" className="btn btn-ghost" disabled={step === "working"} onClick={() => send("resume")}>
          {step === "working" ? "Updating…" : "Keep my plan"}
        </button>
        {error && <p className="panel-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="plan-cancel">
      {step === "confirm" ? (
        <div className="pay-confirm">
          <p>
            Cancel your {planName} plan? You keep it{endsOn ? ` until ${endsOn}` : " until the end of the month you paid for"}, and
            you won&apos;t be charged again.
          </p>
          <div className="pay-actions">
            <button type="button" className="btn btn-small" onClick={() => setStep("idle")}>
              Keep plan
            </button>
            <button type="button" className="pref-remove" onClick={() => send("cancel")}>
              Yes, cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pref-remove" disabled={step === "working"} onClick={() => setStep("confirm")}>
          {step === "working" ? "Canceling…" : "Cancel plan"}
        </button>
      )}
      {error && <p className="panel-error">{error}</p>}
    </div>
  );
}
