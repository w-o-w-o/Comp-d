import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import SearchBar from "./SearchBar";
import MapsProvider from "../maps/MapsProvider";

export const metadata = { title: "Search — Comp'd" };

export default async function SearchPage() {
  // Sends logged-out visitors to the log-in page, then back here afterwards.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/search");

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
      </main>
    </>
  );
}
