// What's left on the user's plan, shown before they reach a limit:
// "Pro plan: 18 of 30 searches and 52 of 60 AI analyses left." `usage` comes
// from planUsage() in lib/access.js (null for pay-per-search: nothing to count).

const shortDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function part(count, noun) {
  const left = Math.max(0, count.max - count.used);
  return `${left} of ${count.max} ${noun}`;
}

export function planUsageText(usage) {
  if (!usage) return null;
  const parts = [part(usage.searches, "searches"), usage.ai && part(usage.ai, "AI analyses")].filter(Boolean);
  // When something is nearly used up, say when the next one frees up.
  const low = [usage.searches, usage.ai].filter((c) => c && c.max - c.used <= 3 && c.nextFree);
  const next = low.length
    ? ` The next one frees up ${shortDate(low.map((c) => c.nextFree).sort()[0])}.`
    : "";
  return `${usage.plan} plan: ${parts.join(" and ")} left. Each frees up 30 days after you use it.${next}`;
}

export default function PlanUsage({ usage, className = "" }) {
  const text = planUsageText(usage);
  return text ? <p className={`panel-muted plan-usage ${className}`.trim()}>{text}</p> : null;
}
