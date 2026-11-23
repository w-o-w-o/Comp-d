"use client";

import { useEffect, useMemo, useState } from "react";
import { MAX_CUSTOM, MAX_CUSTOM_LENGTH, PREFERENCE_BY_ID, preferencesFor } from "./preferences";

const STORAGE_KEY = "compd-ai-priorities-v1";
const EMPTY = { rent: { items: {}, custom: [] }, buy: { items: {}, custom: [] } };

function load() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (saved?.rent && saved?.buy) return saved;
  } catch {}
  return EMPTY;
}

// The user's AI priorities, kept separately for renting and buying and
// remembered in this browser. `payload` is what gets sent to the AI.
export function usePriorities(mode) {
  const [all, setAll] = useState(EMPTY);
  useEffect(() => setAll(load()), []);

  function update(fn) {
    setAll((prev) => {
      const next = { ...prev, [mode]: fn(prev[mode]) };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  const current = all[mode];
  const payload = useMemo(() => {
    const items = preferencesFor(mode)
      .filter((def) => current.items[def.id])
      .map((def) => ({ id: def.id, value: current.items[def.id].value, must: current.items[def.id].must }));
    return items.length || current.custom.length ? { items, custom: current.custom } : null;
  }, [current, mode]);

  return {
    current,
    payload,
    set: (id, entry) =>
      update((m) => {
        const items = { ...m.items };
        if (entry) items[id] = entry;
        else delete items[id];
        return { ...m, items };
      }),
    addCustom: (text) =>
      update((m) => (m.custom.includes(text) ? m : { ...m, custom: [...m.custom, text].slice(0, MAX_CUSTOM) })),
    removeCustom: (text) => update((m) => ({ ...m, custom: m.custom.filter((c) => c !== text) })),
  };
}

// Priority buttons; pressing one turns it on and opens its settings below.
export default function AiPreferences({ priorities, mode, ctx }) {
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState("");
  const defs = preferencesFor(mode);
  const { current } = priorities;
  const activeCount = Object.keys(current.items).filter((id) => defs.some((d) => d.id === id)).length + current.custom.length;

  useEffect(() => setOpen(null), [mode]);

  function press(def) {
    if (!current.items[def.id]) {
      const value = def.defaultValue ? def.defaultValue(mode, ctx) : null;
      priorities.set(def.id, { value, must: Boolean(def.defaultMust) });
      setOpen(def.id);
    } else {
      setOpen(open === def.id ? null : def.id);
    }
  }

  function addCustom(e) {
    e.preventDefault();
    const text = draft.replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM_LENGTH);
    if (!text) return;
    priorities.addCustom(text);
    setDraft("");
  }

  const openDef = open && current.items[open] ? PREFERENCE_BY_ID[open] : null;

  return (
    <div className="ai-prefs">
      <div className="ai-prefs-head">
        <h3>Your priorities</h3>
        <span className="panel-muted">{activeCount ? `${activeCount} selected` : "Optional"}</span>
      </div>
      <div className="pref-chips" role="group" aria-label="Priorities for the AI">
        {defs.map((def) => {
          const entry = current.items[def.id];
          return (
            <button
              key={def.id}
              type="button"
              className={["chip", "pref-chip", entry && "chip-active", open === def.id && "pref-chip-open"].filter(Boolean).join(" ")}
              aria-pressed={Boolean(entry)}
              aria-expanded={open === def.id}
              title={entry ? def.summary(entry.value, mode) : undefined}
              onClick={() => press(def)}
            >
              {def.label}
              {entry?.must && <span className="pref-must">Must</span>}
            </button>
          );
        })}
      </div>

      {openDef && (
        <PreferenceEditor
          def={openDef}
          entry={current.items[openDef.id]}
          mode={mode}
          ctx={ctx}
          onChange={(entry) => priorities.set(openDef.id, entry)}
          onRemove={() => {
            priorities.set(openDef.id, null);
            setOpen(null);
          }}
          onDone={() => setOpen(null)}
        />
      )}

      <form className="pref-custom-form" onSubmit={addCustom}>
        <input
          type="text"
          value={draft}
          maxLength={MAX_CUSTOM_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={mode === "rent" ? "Add your own, e.g. pet friendly, parking" : "Add your own, e.g. garage, single story"}
          aria-label="Add your own priority"
          disabled={current.custom.length >= MAX_CUSTOM}
        />
        <button type="submit" className="btn btn-small" disabled={!draft.trim() || current.custom.length >= MAX_CUSTOM}>
          Add
        </button>
      </form>
      {current.custom.length > 0 && (
        <div className="pref-chips">
          {current.custom.map((c) => (
            <span key={c} className="chip chip-active pref-custom">
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => priorities.removeCustom(c)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {current.custom.length > 0 && (
        <p className="panel-muted pref-hint">
          The AI checks your own priorities against the listing data and tells you if the data doesn&apos;t cover them.
        </p>
      )}
    </div>
  );
}

function PreferenceEditor({ def, entry, mode, ctx, onChange, onRemove, onDone }) {
  const controls = def.controls
    ? def.controls.map((c) => ({ ...c, value: entry.value?.[c.key], set: (v) => onChange({ ...entry, value: { ...entry.value, [c.key]: v } }) }))
    : def.control
      ? [{ ...def.control(mode, ctx), value: entry.value, set: (v) => onChange({ ...entry, value: v }) }]
      : [];

  return (
    <div className="pref-editor">
      <div className="pref-editor-head">
        <strong>{def.label}</strong>
        <span className="panel-muted">{def.summary(entry.value, mode)}</span>
      </div>

      {controls.map((c) =>
        c.type === "select" ? (
          <div key={c.label} className="pref-control">
            <span className="pref-control-label">{c.label}</span>
            <div className="pref-options">
              {c.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={c.value === o.value ? "chip chip-active" : "chip"}
                  aria-pressed={c.value === o.value}
                  onClick={() => c.set(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label key={c.label} className="pref-control">
            <span className="pref-control-label">
              {c.label} <strong>{c.format(c.value)}</strong>
            </span>
            <input
              type="range"
              min={c.min}
              max={c.max}
              step={c.step}
              value={Math.min(c.max, Math.max(c.min, c.value))}
              onChange={(e) => c.set(Number(e.target.value))}
            />
          </label>
        )
      )}

      {def.hint && <p className="panel-muted pref-hint">{def.hint}</p>}

      <div className="pref-editor-foot">
        <div className="mode-toggle pref-importance" role="group" aria-label="Importance">
          {[
            [false, "Nice to have"],
            [true, "Must have"],
          ].map(([must, label]) => (
            <button
              key={label}
              type="button"
              className={entry.must === must ? "chip chip-active" : "chip"}
              aria-pressed={entry.must === must}
              onClick={() => onChange({ ...entry, must })}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="pref-link" onClick={onRemove}>
          Remove
        </button>
        <button type="button" className="pref-link" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
