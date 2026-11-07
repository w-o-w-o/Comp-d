import { SignUp } from "@clerk/nextjs";
import Nav from "../../Nav";

export const metadata = { title: "Sign up — Comp'd" };

export default function SignUpPage() {
  return (
    <>
      <Nav />
      <main className="wrap auth-page">
        <SignUp />
      </main>
    </>
  );
}
