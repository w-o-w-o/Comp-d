import { SignIn } from "@clerk/nextjs";
import Nav from "../../Nav";
import { afterAuthUrl } from "../../afterAuth";

export const metadata = { title: "Log in — Comp'd" };

export default async function SignInPage({ searchParams }) {
  const to = afterAuthUrl((await searchParams)?.redirect_url);
  return (
    <>
      <Nav />
      <main className="wrap auth-page">
        <SignIn forceRedirectUrl={to} signUpForceRedirectUrl={to} />
      </main>
    </>
  );
}
