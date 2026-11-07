import Link from "next/link";
import Nav from "./Nav";

const steps = [
  {
    title: "Enter an address",
    text: "Paste in the house or rental you're looking at — or just the neighborhood you want to live in.",
  },
  {
    title: "Draw your search area",
    text: "Choose a radius or neighborhood. Comp'd pulls every comparable home for sale or rent inside it.",
  },
  {
    title: "Set your priorities",
    text: "Tell us what matters most — price, space, schools, commute — and we weight the comparison to match.",
  },
  {
    title: "Get a clear verdict",
    text: "See whether the place is worth it, how it ranks against nearby options, and which homes beat it.",
  },
];

const categories = [
  { name: "Price & rent", detail: "Price per sq ft, rent per bedroom, recent sales" },
  { name: "Space & layout", detail: "Square footage, bedrooms, bathrooms, lot size" },
  { name: "Monthly costs", detail: "HOA fees, property taxes, utilities, insurance" },
  { name: "Schools", detail: "Assigned schools and their ratings" },
  { name: "Commute", detail: "Drive, transit, bike, and walk times to where you go" },
  { name: "Safety", detail: "Neighborhood crime trends over time" },
  { name: "Walkability", detail: "Groceries, parks, restaurants, and gyms nearby" },
  { name: "Condition & age", detail: "Year built, renovations, appliances" },
  { name: "Market trend", detail: "Whether prices in the area are rising or falling" },
  { name: "Lifestyle fit", detail: "Parking, pets, laundry, outdoor space, noise" },
];

const audiences = [
  {
    who: "Renters",
    text: "Find out if that apartment is fairly priced before you sign a 12-month lease — and see better units a few blocks away.",
  },
  {
    who: "Home buyers",
    text: "Know what a house is actually worth compared with recent sales nearby, so you can offer with confidence.",
  },
  {
    who: "Sellers",
    text: "See how your home stacks up against the competition and price it to sell — not sit.",
  },
  {
    who: "Forever-home seekers",
    text: "Weight the things that matter for the long haul — schools, space, commute — and find the place that fits for decades.",
  },
  {
    who: "Realtors",
    text: "Back up your recommendations with clean, data-driven comparisons you can share with clients in minutes.",
  },
];

const reasons = [
  {
    title: "Stop overpaying",
    text: "Paying just $100 a month too much in rent adds up to $1,200 a year. One Comp'd report can catch that before you sign.",
  },
  {
    title: "Hours of research in seconds",
    text: "No more juggling a dozen listing tabs and spreadsheets. Comp'd gathers the comparisons and does the math for you.",
  },
  {
    title: "Built around you",
    text: "Generic estimates treat every buyer the same. Comp'd ranks homes by what you told it matters most.",
  },
  {
    title: "Negotiate with evidence",
    text: "Walk into a negotiation with comparable listings and a clear value score, not just a gut feeling.",
  },
];

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "",
    blurb: "Try it on the place you're eyeing.",
    features: ["3 comparisons per month", "Basic value verdict", "Price & space categories"],
    cta: "Start free",
  },
  {
    name: "Plus",
    price: "$9",
    period: "/month",
    blurb: "For renters and buyers actively searching.",
    features: [
      "Unlimited comparisons",
      "All 10 comparison categories",
      "Custom priority weighting",
      "Saved searches & alerts",
    ],
    cta: "Get Plus",
    featured: true,
  },
  {
    name: "Pro",
    price: "$29",
    period: "/month",
    blurb: "For realtors and frequent investors.",
    features: [
      "Everything in Plus",
      "Shareable client reports",
      "Manage multiple client profiles",
      "Priority support",
    ],
    cta: "Go Pro",
  },
];

export default function Home() {
  return (
    <>
      <Nav />

      <main id="top">
        <section className="wrap hero">
          <div className="hero-text">
            <p className="eyebrow">Smarter home comparisons</p>
            <h1>Know if a home is worth it before you commit.</h1>
            <p className="lede">
              Enter any house or rental address. Comp&apos;d compares it against
              every similar home in the area you choose, ranks them by what
              matters to you, and tells you plainly whether it&apos;s a good
              deal and what to look at instead.
            </p>
            <div className="hero-actions">
              <Link href="/sign-up" className="btn">
                Try it free
              </Link>
              <a href="#how" className="btn btn-ghost">
                See how it works
              </a>
            </div>
          </div>

          <div className="sample" aria-label="Example Comp'd result">
            <p className="sample-tag">Example result</p>
            <p className="sample-address">2-bed apartment · $1,850/mo</p>
            <p className="sample-meta">Compared with 42 rentals within 1 mile</p>
            <div className="verdict">
              <span className="verdict-badge">Worth it</span>
              <span>7% below similar rentals nearby</span>
            </div>
            <ul className="scores">
              <li>
                <span>Price</span>
                <span className="bar"><span style={{ width: "86%" }} /></span>
              </li>
              <li>
                <span>Commute</span>
                <span className="bar"><span style={{ width: "74%" }} /></span>
              </li>
              <li>
                <span>Space</span>
                <span className="bar"><span style={{ width: "58%" }} /></span>
              </li>
              <li>
                <span>Walkability</span>
                <span className="bar"><span style={{ width: "91%" }} /></span>
              </li>
            </ul>
            <p className="sample-foot">3 nearby rentals score higher on space →</p>
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <h2 className="section-title">How it works</h2>
            <p className="section-sub">
              From one address to a confident decision in four steps.
            </p>
            <ol className="steps">
              {steps.map((step, i) => (
                <li className="card" key={step.title}>
                  <span className="step-num">{i + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section section-alt">
          <div className="wrap">
            <h2 className="section-title">Everything that matters, compared</h2>
            <p className="section-sub">
              Comp&apos;d looks well beyond the price tag. Every home is scored
              across ten categories, and you decide how much each one counts.
            </p>
            <ul className="categories">
              {categories.map((c) => (
                <li key={c.name}>
                  <strong>{c.name}</strong>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="who" className="section">
          <div className="wrap">
            <h2 className="section-title">Who it&apos;s for</h2>
            <p className="section-sub">
              Anyone making a decision about where to live or what a home is
              worth.
            </p>
            <div className="audiences">
              {audiences.map((a) => (
                <div className="card" key={a.who}>
                  <h3>{a.who}</h3>
                  <p>{a.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt">
          <div className="wrap">
            <h2 className="section-title">Why it&apos;s worth paying for</h2>
            <p className="section-sub">
              A home is the biggest expense most people have. A few dollars to
              get it right pays for itself.
            </p>
            <div className="reasons">
              {reasons.map((r) => (
                <div key={r.title}>
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="section">
          <div className="wrap">
            <h2 className="section-title">Simple pricing</h2>
            <p className="section-sub">Start free. Upgrade when you&apos;re ready.</p>
            <div className="plans">
              {plans.map((p) => (
                <div className={`card plan${p.featured ? " plan-featured" : ""}`} key={p.name}>
                  {p.featured && <span className="plan-flag">Most popular</span>}
                  <h3>{p.name}</h3>
                  <p className="plan-price">
                    {p.price}
                    <span>{p.period}</span>
                  </p>
                  <p className="plan-blurb">{p.blurb}</p>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <Link href="/sign-up" className={`btn${p.featured ? "" : " btn-ghost"}`}>
                    {p.cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="wrap closing">
          <h2>Your next home should be a sure thing.</h2>
          <p>Compare it before you commit.</p>
          <Link href="/sign-up" className="btn">
            Try Comp&apos;d free
          </Link>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span className="logo">Comp&apos;d</span>
          <span>Sara Petollari</span>
        </div>
      </footer>
    </>
  );
}
