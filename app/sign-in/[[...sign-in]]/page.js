import { SignIn } from "@clerk/nextjs";
import Nav from "../../Nav";

export const metadata = { title: "Log in — Comp'd" };

export default function SignInPage() {
  return (
    <>
      <Nav />
      <main className="wrap auth-page">
        <SignIn />
      </main>
    </>
  );
}
