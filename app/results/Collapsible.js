"use client";

// A section that starts closed and opens on click. `peek` is a one-line
// preview shown next to the title while it's closed.
export default function Collapsible({ title, peek, warn = false, children, className = "" }) {
  return (
    <details className={`collapsible ${className}`}>
      <summary>
        <span className="collapsible-title">{title}</span>
        {peek && (
          <span
            className={warn ? "collapsible-peek collapsible-peek-warn" : "collapsible-peek"}
            title={typeof peek === "string" ? peek : undefined}
          >
            {peek}
          </span>
        )}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
