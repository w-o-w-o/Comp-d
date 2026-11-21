import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import MapsProvider from "../maps/MapsProvider";
import ResultsView from "./ResultsView";
import { MAX_RADIUS_MILES, MIN_RADIUS_MILES } from "../maps/config";

export const metadata = { title: "Results — Comp'd" };

export default async function ResultsPage({ searchParams }) {
  const params = await searchParams;
  const { address = "", placeId = "", radius = "", mode = "", from = "" } = params;

  // Sends logged-out visitors to the log-in page, then back to this search.
  const { userId } = await auth();
  if (!userId) {
    const back = `/results?${new URLSearchParams(params)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }

  if (!address.trim()) redirect("/search");

  // Reopened from search history: start on the results with the saved settings.
  const fromHistory = from === "history";
  const savedRadius = Number(radius);
  const initialRadius =
    fromHistory && savedRadius >= MIN_RADIUS_MILES && savedRadius <= MAX_RADIUS_MILES
      ? savedRadius
      : undefined;
  const initialMode = fromHistory && (mode === "buy" || mode === "rent") ? mode : undefined;

  return (
    <>
      <Nav />
      <MapsProvider>
        <main>
          {/* key: a new search (or reopening a saved one) restarts the view */}
          <ResultsView
            key={[placeId || address, from, mode, radius].join("|")}
            address={address}
            placeId={placeId}
            initialRadius={initialRadius}
            initialMode={initialMode}
            fromHistory={fromHistory}
          />
        </main>
      </MapsProvider>
    </>
  );
}
