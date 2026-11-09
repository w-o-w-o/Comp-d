"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

// Address search box. When Google Maps is available, it suggests real
// addresses as the user types (Places API autocomplete).
export default function SearchBar({ initialAddress = "", autoFocus = true }) {
  const router = useRouter();
  const places = useMapsLibrary("places"); // null until Maps loads, or with no key
  const [address, setAddress] = useState(initialAddress);
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const sessionToken = useRef(null);
  const userTyped = useRef(false);

  useEffect(() => {
    // Don't suggest for the address already filled in on the results page.
    if (!places || !userTyped.current) return;
    const input = address.trim();
    if (input.length < 3) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      // One session token per search groups the requests for Google's billing.
      sessionToken.current ??= new places.AutocompleteSessionToken();
      try {
        const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionToken.current,
        });
        if (cancelled) return;
        setSuggestions(result.suggestions.filter((s) => s.placePrediction).slice(0, 5));
        setActive(-1);
        setOpen(true);
      } catch (err) {
        console.error("Address suggestions failed:", err);
        if (!cancelled) setSuggestions([]);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address, places]);

  function goToResults(text, placeId) {
    const params = new URLSearchParams({ address: text });
    if (placeId) params.set("placeId", placeId);
    router.push(`/results?${params}`);
  }

  function choose(suggestion) {
    const prediction = suggestion.placePrediction;
    const text = prediction.text.toString();
    sessionToken.current = null;
    userTyped.current = false;
    setAddress(text);
    setSuggestions([]);
    setOpen(false);
    goToResults(text, prediction.placeId);
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Prefer a Google-verified address: the highlighted one, else the top match.
    const picked = suggestions[active] ?? suggestions[0];
    if (open && picked) return choose(picked);
    const trimmed = address.trim();
    if (trimmed) goToResults(trimmed);
  }

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <form className="search-form" onSubmit={handleSubmit} role="search">
      <div className="search-field">
        <input
          type="text"
          name="address"
          value={address}
          onChange={(e) => {
            userTyped.current = true;
            setAddress(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="e.g. 123 Main St, San Luis Obispo, CA"
          aria-label="Address"
          role="combobox"
          aria-expanded={showList}
          aria-controls="address-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `suggestion-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        {showList && (
          <ul className="suggestions" id="address-suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.placePrediction.placeId}
                id={`suggestion-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                // mouseDown fires before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <strong>{s.placePrediction.mainText?.toString()}</strong>
                <span>{s.placePrediction.secondaryText?.toString()}</span>
              </li>
            ))}
            <li className="suggestions-credit" aria-hidden="true">
              Powered by Google
            </li>
          </ul>
        )}
      </div>
      <button type="submit" className="btn" disabled={!address.trim()}>
        Search
      </button>
    </form>
  );
}
