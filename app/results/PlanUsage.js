// What's left on the user's plan, shown before they reach a limit:
// "Pro plan: 112 of 150 credits left…" `usage` comes from planUsage() in
// lib/access.js (null for pay-per-search: nothing to count).
import { CREDIT_COST } from "../../lib/prices";

const shortDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function part(count, noun) {
  const left = Math.max(0, count.max - count.used);
  return `${left} of ${count.max} ${noun}`;
}

export function planUsageText(usage) {
  if (!usage?.credits) return null;
  const c = usage.credits;
  // When credits are nearly used up, say when more free up.
  const next = c.max - c.used < 5 && c.nextFree ? ` More free up ${shortDate(c.nextFree)}.` : "";
  return (
    `${usage.plan} plan: ${part(c, "credits")} left. A search uses ${CREDIT_COST.search} (with its first AI analysis), ` +
    `a re-analysis uses ${CREDIT_COST.reanalysis}. Each frees up 30 days after you use it.${next}`
  );
}

export default function PlanUsage({ usage, className = "" }) {
  const text = planUsageText(usage);
  return text ? <p className={`panel-muted plan-usage ${className}`.trim()}>{text}</p> : null;
}
