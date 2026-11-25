"use client";

import { useEffect, useMemo, useState } from "react";
import { distanceMiles, fetchRadiusFor } from "./geo";

// Loads the property estimate and nearby listings from /api/comps, and returns
// the listings inside the current radius, nearest first. A locked search comes
// back as { status: "locked", payment } so the page can offer to unlock it;
// reload() fetches again (after paying).
export default function useComparables({ position, address, mode, radiusMiles }) {
  const fetchRadius = fetchRadiusFor(radiusMiles);
  const [state, setState] = useState({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    setState({ status: "loading" });

    // Short delay so dragging the circle across a boundary fetches only once.
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({
        lat: String(position.lat),
        lng: String(position.lng),
        radius: String(fetchRadius),
        mode,
        address: address || "",
      });
      try {
        const res = await fetch(`/api/comps?${params}`);
        const body = await res.json();
        if (cancelled) return;
        if (res.status === 402 && body.payment) setState({ status: "locked", message: body.error, payment: body.payment });
        else if (!res.ok) setState({ status: "error", message: body.error });
        else setState({ status: "ready", data: body });
      } catch {
        if (!cancelled) setState({ status: "error", message: "Couldn't load property data." });
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [position, address, mode, fetchRadius, attempt]);

  const nearby = useMemo(() => {
    if (state.status !== "ready" || !position) return [];
    return state.data.listings
      .map((l) => ({ ...l, distance: distanceMiles(position, l) }))
      .filter((l) => l.distance <= radiusMiles)
      .sort((a, b) => a.distance - b.distance);
  }, [state, position, radiusMiles]);

  return { ...state, nearby, reload: () => setAttempt((n) => n + 1) };
}
