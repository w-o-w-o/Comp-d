import "./globals.css";

export const metadata = {
  title: "Comp'd — Is that place worth it?",
  description:
    "Compare any house or rental against nearby listings and find out if it's worth the price.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
