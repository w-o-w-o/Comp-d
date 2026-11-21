import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Nav from "../Nav";
import HistoryList from "./HistoryList";
import { listSearches, toListEntries } from "../../lib/history";

export const metadata = { title: "Search history — Comp'd" };

export default async function HistoryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/history");
  const entries = toListEntries(await listSearches(userId));

  return (
    <>
      <Nav />
      <main className="wrap account">
        <p className="eyebrow">Search history</p>
        <h1>Your past searches</h1>
        <p className="lede">
          Every place you search is saved here with its radius and rent/buy choice. Open one to
          go straight back to its results.
        </p>
        <div className="history-page">
          <HistoryList entries={entries} />
        </div>
        <div className="account-actions">
          <Link href="/search" className="btn">
            New search
          </Link>
        </div>
      </main>
    </>
  );
}
