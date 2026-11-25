import { SignUp } from "@clerk/nextjs";
import Nav from "../../Nav";
import { afterAuthUrl } from "../../afterAuth";

export const metadata = { title: "Sign up — Comp'd" };

export default async function SignUpPage({ searchParams }) {
  const to = afterAuthUrl((await searchParams)?.redirect_url);
  return (
    <>
      <Nav />
      <main className="wrap auth-page">
        <SignUp forceRedirectUrl={to} signInForceRedirectUrl={to} />
      </main>
    </>
  );
}
