import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import SearchBar from "./SearchBar";
import MapsProvider from "../maps/MapsProvider";
import HistoryList from "../history/HistoryList";
import { listSearches, toListEntries } from "../../lib/history";
import { CREDIT_COST, formatCents, getUserPlan, SEARCH_PRICE } from "../../lib/plans";
import { planUsage } from "../../lib/access";
import { planUsageText } from "../results/PlanUsage";

export const metadata = { title: "Search — Comp'd" };

const RECENT_COUNT = 5;

export default async function SearchPage() {
  // Sends logged-out visitors to the log-in page, then back here afterwards.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/search");
  const access = await getUserPlan(userId);
  const [searches, usage] = await Promise.all([listSearches(userId, RECENT_COUNT), planUsage(userId, access)]);
  const recent = toListEntries(searches);
  // Subscribers see what's left on their plan instead of the per-search price.
  const usageText = planUsageText(usage);
  // Searching is free until something needs paying for, and the page always asks first.
  const creditsLeft = usage?.credits ? usage.credits.max - usage.credits.used : null;
  const reassurance = access.fullAccess
    ? null
    : creditsLeft == null
      ? "Don't worry, we'll prompt you when you need to pay."
      : creditsLeft >= CREDIT_COST.search
        ? "Searches come out of your plan's credits. We'll ask you before anything costs extra."
        : "You're out of credits for a new search, so we'll ask you before charging for one.";

  return (
    <>
      <Nav />
      <main className="wrap search-page">
        <h1>Search for address...</h1>
        <p className="search-hint">
          Enter the house or rental you&apos;re interested in and we&apos;ll
          compare it with similar homes nearby.
        </p>
        <MapsProvider>
          <SearchBar />
        </MapsProvider>
        {reassurance && <p className="search-reassure">{reassurance}</p>}
        {access.fullAccess ? null : usageText ? (
          <p className="search-pricing">
            {usageText} <Link href="/account">See your plan</Link>.
          </p>
        ) : (
          <p className="search-pricing">
            Each search is {formatCents(SEARCH_PRICE)} and includes an AI analysis and 3 commute checks, or{" "}
            <Link href="/#pricing">get a monthly plan</Link>.
          </p>
        )}

        <div className="try-free">
          <div>
            <strong>Not sure yet? Try it free.</strong>
            <span>
              Explore a real search we&apos;ve picked for this week, with the AI analysis already run. It changes
              every week.
            </span>
          </div>
          <Link href="/results?demo=1" className="btn btn-ghost">
            Try it free
          </Link>
        </div>

        {recent.length > 0 && (
          <section className="recent-searches" aria-labelledby="recent-title">
            <div className="recent-head">
              <h2 id="recent-title">Recent searches</h2>
              <Link href="/history">See all</Link>
            </div>
            <HistoryList entries={recent} compact />
          </section>
        )}
      </main>
    </>
  );
}
