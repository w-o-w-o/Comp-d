// Prices and credit costs, safe to import from browser code (lib/plans.js
// re-exports them for the server). All amounts are US cents.

export const SEARCH_PRICE = 250; // one search: listings for 7 days, 1 AI analysis, commute checks
export const REANALYSIS_PRICE = 50; // each AI analysis after the one a search includes
// Re-analyses go on a tab: TAB_HOLD is held on the card when the tab opens, and
// only what was used is charged, in one payment, when the tab closes (full, or
// TAB_HOURS after it opened). One Stripe fee per tab instead of one per $0.50.
// Stripe's smallest charge is $0.50, so REANALYSIS_PRICE must stay at least 50.
export const TAB_HOLD = 500;
export const TAB_HOURS = 24;
// Plan credits. A search is 40% cheaper than pay-per-search; a re-analysis
// costs 2 so heavy re-analysis can't run the plan at a loss. If only 1 credit
// is left, a re-analysis takes it (so no credit is stranded).
export const CREDIT_COST = { search: 5, reanalysis: 2 };

// "$0.50", "$5", "$2.50"
export const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
