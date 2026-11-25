import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import MapsProvider from "../maps/MapsProvider";
import ResultsView from "./ResultsView";
import { MAX_RADIUS_MILES, MIN_RADIUS_MILES } from "../maps/config";

export const metadata = { title: "Results — Comp'd" };

export default async function ResultsPage({ searchParams }) {
  const params = await searchParams;
  const { address = "", placeId = "", radius = "", mode = "", from = "", demo = "" } = params;
  // "Try it free": this week's demo address, chosen by Comp'd.
  const isDemo = demo === "1";

  // Sends logged-out visitors to the log-in page, then back to this search.
  const { userId } = await auth();
  if (!userId) {
    const back = `/results?${new URLSearchParams(params)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }

  if (!address.trim() && !isDemo) redirect("/search");

  // Reopened from search history (or back from paying): start on the results
  // with the saved settings. The demo opens straight on its results too.
  const fromHistory = from === "history" || isDemo;
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
            key={[isDemo ? "demo" : placeId || address, from, mode, radius].join("|")}
            address={address}
            placeId={placeId}
            initialRadius={initialRadius ?? (isDemo ? 1 : undefined)}
            initialMode={initialMode}
            fromHistory={fromHistory}
            demo={isDemo}
          />
        </main>
      </MapsProvider>
    </>
  );
}
