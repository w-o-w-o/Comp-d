"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Plain text input for now. Google Maps Places Autocomplete will attach to
// this input later so addresses are suggested and validated as the user types.
export default function SearchBar({ initialAddress = "" }) {
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) return;
    router.push(`/results?address=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form className="search-form" onSubmit={handleSubmit} role="search">
      <input
        type="text"
        name="address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="e.g. 123 Main St, San Luis Obispo, CA"
        aria-label="Address"
        autoComplete="street-address"
        autoFocus
      />
      <button type="submit" className="btn" disabled={!address.trim()}>
        Search
      </button>
    </form>
  );
}
