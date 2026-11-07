import Link from "next/link";
import { Show, SignOutButton, UserButton } from "@clerk/nextjs";

export default function Nav() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="logo">
          Comp&apos;d
        </Link>
        <div className="nav-links">
          <Link href="/#how">How it works</Link>
          <Link href="/#who">Who it&apos;s for</Link>
          <Link href="/#pricing">Pricing</Link>
        </div>
        <div className="nav-auth">
          <Show when="signed-out">
            <Link href="/sign-in" className="nav-login">
              Log in
            </Link>
            <Link href="/sign-up" className="btn btn-small">
              Sign up
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/account" className="nav-login">
              My account
            </Link>
            <SignOutButton>
              <button className="btn btn-small btn-ghost">Log out</button>
            </SignOutButton>
            <UserButton />
          </Show>
        </div>
      </div>
    </nav>
  );
}
