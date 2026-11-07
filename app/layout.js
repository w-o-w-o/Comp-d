import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata = {
  title: "Comp'd — Is that place worth it?",
  description:
    "Enter any house or rental address and Comp'd compares it with similar homes nearby, ranked by what matters to you — for renters, buyers, sellers, and realtors.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/account"
      signUpFallbackRedirectUrl="/account"
      afterSignOutUrl="/"
      appearance={{ variables: { colorPrimary: "#1f7a5a" } }}
    >
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
