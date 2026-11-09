import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import MapsProvider from "../maps/MapsProvider";
import ResultsView from "./ResultsView";

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
        <main>
          {/* key: a new search restarts the zoom-in flow */}
          <ResultsView key={placeId || address} address={address} placeId={placeId} />
        </main>
      </MapsProvider>
    </>
  );
}
