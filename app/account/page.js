import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Nav from "../Nav";

export const metadata = { title: "My account — Comp'd" };

export default async function AccountPage() {
  // Sends logged-out visitors to the log-in page, then back here afterwards.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");
  const user = await currentUser();
  const email = user.primaryEmailAddress?.emailAddress;
  const name = user.firstName || email;
  const joined = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <Nav />
      <main className="wrap account">
        <p className="eyebrow">My account</p>
        <h1>Welcome, {name}!</h1>
        <p className="lede">You&apos;re logged in to Comp&apos;d.</p>

        <div className="account-grid">
          <div className="card">
            <h3>Your details</h3>
            <dl className="details">
              <dt>Email</dt>
              <dd>{email}</dd>
              <dt>Member since</dt>
              <dd>{joined}</dd>
              <dt>Plan</dt>
              <dd>Free</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Saved comparisons</h3>
            <p>
              You haven&apos;t compared any homes yet. Comparisons you run will
              show up here.
            </p>
          </div>
        </div>

        <div className="account-actions">
          <Link href="/search" className="btn">
            Start a search
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
          <SignOutButton>
            <button className="btn btn-ghost">Log out</button>
          </SignOutButton>
        </div>
      </main>
    </>
  );
}
