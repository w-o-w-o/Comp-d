import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import SearchBar from "../search/SearchBar";
import MapsProvider from "../maps/MapsProvider";
import ResultsMap from "./ResultsMap";

export const metadata = { title: "Results — Comp'd" };

export default async function ResultsPage({ searchParams }) {
  const { address = "", placeId = "" } = await searchParams;

  // Sends logged-out visitors to the log-in page, then back to this search.
  const { userId } = await auth();
  if (!userId) {
    const params = new URLSearchParams({ address });
    if (placeId) params.set("placeId", placeId);
    const back = `/results?${params}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }

  if (!address.trim()) redirect("/search");

  return (
    <>
      <Nav />
      <MapsProvider>
        <main className="wrap results">
          <div className="results-search">
            <SearchBar initialAddress={address} autoFocus={false} />
          </div>

          <p className="eyebrow">Comparing</p>
          <h1>{address}</h1>

          <ResultsMap address={address} placeId={placeId} />

          <div className="results-grid">
            <div className="card placeholder">
              <h3>Verdict</h3>
              <p>Whether this home is worth it, and why, will appear here.</p>
            </div>
            <div className="card placeholder">
              <h3>Comparable homes</h3>
              <p>Similar homes in your search area, ranked by your priorities.</p>
            </div>
          </div>

          <Link href="/search" className="btn btn-ghost">
            New search
          </Link>
        </main>
      </MapsProvider>
    </>
  );
}
