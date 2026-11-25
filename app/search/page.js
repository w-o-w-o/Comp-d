import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import SearchBar from "./SearchBar";
import MapsProvider from "../maps/MapsProvider";
import HistoryList from "../history/HistoryList";
import { listSearches, toListEntries } from "../../lib/history";

export const metadata = { title: "Search — Comp'd" };

const RECENT_COUNT = 5;

export default async function SearchPage() {
  // Sends logged-out visitors to the log-in page, then back here afterwards.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/search");
  const recent = toListEntries(await listSearches(userId, RECENT_COUNT));

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
        <p className="search-pricing">
          Each search is $2.50 and includes an AI analysis and 3 commute checks, or{" "}
          <Link href="/#pricing">get a monthly plan</Link>.
        </p>

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
