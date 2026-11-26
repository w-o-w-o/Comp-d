import Link from "next/link";
import Nav from "./Nav";
import { CREDIT_COST, PLANS, REANALYSIS_PRICE, SEARCH_PRICE, TAB_HOLD } from "../lib/plans";

const usd = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

const steps = [
  {
    title: "Enter an address",
    text: "Type the house or rental you're looking at, and choose whether you're renting or buying.",
  },
  {
    title: "Pick your search area",
    text: "Drag the circle on the map or choose a radius from ½ to 5 miles. Comp'd pulls every home for rent or sale inside it.",
  },
  {
    title: "Set your priorities",
    text: "Budget, space, commute, in-unit laundry, schools: mark each as a must-have or nice-to-have, or type your own.",
  },
  {
    title: "Get a clear verdict",
    text: "The AI tells you if it's a good deal, fair, or overpriced, and which nearby homes are better value, with the facts behind every pick.",
  },
];

const reasons = [
  {
    title: "Stop overpaying",
    text: "Paying just $100 a month too much in rent adds up to $1,200 a year. One Comp'd search can catch that before you sign.",
  },
  {
    title: "Built around you",
    text: "No more juggling listing tabs and spreadsheets. Comp'd does the research in minutes and ranks homes by what you told it matters most.",
  },
  {
    title: "Negotiate with evidence",
    text: "Walk in knowing the comparable prices, how long a home has been listed, and whether its price was cut.",
  },
  {
    title: "Pay only for what you use",
    text: `No subscription needed: ${usd(SEARCH_PRICE)} a search, charged once on a ${usd(TAB_HOLD)} hold. Plans save you more if you search a lot.`,
  },
];

// What Comp'd actually compares, and where the data comes from.
const categories = [
  {
    name: "Price & value",
    detail: "Price per sq ft and per bedroom against nearby listings, the property's estimate, and the area's fair market rent",
    source: "RentCast, HUD, Census",
  },
  {
    name: "Space & layout",
    detail: "Square footage, bedrooms, bathrooms, and lot size",
    source: "RentCast",
  },
  {
    name: "Monthly costs",
    detail: "Estimated mortgage payment and HOA fees for buyers; rent per person and included utilities for renters",
    source: "RentCast, listing pages",
  },
  {
    name: "Rental amenities",
    detail: "Whether it's still available, in-unit laundry, A/C, parking, pets, and whether heat, water, or Wi-Fi is included",
    source: "Listing pages, linked",
  },
  {
    name: "Your own priorities",
    detail: 'Anything you type, like "dishwasher" or "garage", checked on each home\'s listing page',
    source: "Listing pages, linked",
  },
  {
    name: "Commute",
    detail: "Drive, transit, bike, and walk times from each home to where you go",
    source: "Google Maps",
  },
  {
    name: "Neighborhood",
    detail: "Groceries, parks, restaurants, and transit stops nearby, plus a walkability score",
    source: "Google Maps, EPA",
  },
  {
    name: "Schools",
    detail: "Distance to the nearest public elementary, middle, and high school, and the school district",
    source: "NCES",
  },
  {
    name: "Flood risk",
    detail: "The flood zone of each home, which can mean required flood insurance",
    source: "FEMA",
  },
  {
    name: "Safety",
    detail: "Reported crime rates for the city, compared with state and U.S. rates",
    source: "FBI",
  },
  {
    name: "Market trend",
    detail: "Whether rents and home values in the ZIP code are rising or falling, days listed, and price cuts",
    source: "Zillow, RentCast",
  },
  {
    name: "Building age",
    detail: "Year built, for homes that list it",
    source: "RentCast",
  },
];

const plans = [
  {
    name: PLANS.free.name,
    price: usd(SEARCH_PRICE),
    period: "/search",
    blurb: "For checking the one place you're eyeing.",
    features: [
      "Every home for rent or sale in your radius, for 7 days",
      `1 AI analysis included, +${usd(REANALYSIS_PRICE)} per re-analysis`,
      `${PLANS.free.commutesPerSearch} commute checks`,
      `Paid on a ${usd(TAB_HOLD)} hold: charged once, only for what you use`,
    ],
    cta: "Search an address",
    href: "/search",
  },
  {
    name: PLANS.basic.name,
    price: usd(PLANS.basic.price),
    period: "/month",
    blurb: "For renters and buyers actively searching.",
    features: [
      `${PLANS.basic.creditsPer30Days} credits a month, spent however you like`,
      `A search uses ${CREDIT_COST.search} credits and includes its first AI analysis`,
      `A re-analysis uses ${CREDIT_COST.reanalysis} credits`,
      `${PLANS.basic.commutesPerSearch} commute checks per search`,
    ],
    note: `That's up to ${PLANS.basic.creditsPer30Days / CREDIT_COST.search} searches (${usd(PLANS.basic.price / (PLANS.basic.creditsPer30Days / CREDIT_COST.search))} each instead of ${usd(SEARCH_PRICE)}), or a mix like 6 searches and 10 re-analyses.`,
    cta: `Get ${PLANS.basic.name}`,
    href: "/api/checkout?plan=basic",
    featured: true,
  },
  {
    name: PLANS.advanced.name,
    price: usd(PLANS.advanced.price),
    period: "/month",
    blurb: "For heavy searchers, investors, and realtors.",
    features: [
      `${PLANS.advanced.creditsPer30Days} credits a month, spent however you like`,
      `Same credits as Basic: a search uses ${CREDIT_COST.search}, a re-analysis ${CREDIT_COST.reanalysis}`,
      `${PLANS.advanced.commutesPerSearch} commute checks per search`,
    ],
    cta: `Get ${PLANS.advanced.name}`,
    href: "/api/checkout?plan=advanced",
    note: `That's up to ${PLANS.advanced.creditsPer30Days / CREDIT_COST.search} searches (${usd(Math.round(PLANS.advanced.price / (PLANS.advanced.creditsPer30Days / CREDIT_COST.search)))} each), or a mix like 20 searches and 25 re-analyses. Your account page shows what's left.`,
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
              <Link href="/search" className="btn">
                Start searching · {usd(SEARCH_PRICE)}
              </Link>
              <Link href="/results?demo=1" className="btn btn-ghost">
                Try it free
              </Link>
            </div>
            <p className="hero-note">
              {usd(SEARCH_PRICE)} a search, with an AI analysis included, or{" "}
              <a href="#pricing">save with a monthly plan</a>. <a href="#how">See how it works</a>
            </p>
          </div>

          {/* Mirrors the real AI result: a verdict, amenity chips, better deals. */}
          <div className="sample" aria-label="Example Comp'd result">
            <p className="sample-tag">Example result</p>
            <p className="sample-address">2-bed apartment · $1,850/mo</p>
            <p className="sample-meta">Compared with 42 rentals within 1 mile</p>
            <div className="verdict">
              <span className="verdict-badge">Good deal</span>
              <span>7% below similar rentals nearby</span>
            </div>
            <ul className="sample-facts">
              <li>$925 per bedroom, $140 under the area&apos;s fair market rent</li>
              <li>18 min by transit to your office</li>
              <li>Minimal flood risk · walkability 16 of 20</li>
            </ul>
            <ul className="amenity-chips" aria-label="Amenities found online">
              <li className="amenity-chip amenity-yes">✓ Laundry</li>
              <li className="amenity-chip amenity-yes">✓ A/C</li>
              <li className="amenity-chip amenity-yes">✓ Heat incl.</li>
              <li className="amenity-chip amenity-no">✗ Parking</li>
              <li className="amenity-chip amenity-unknown">? Pets</li>
            </ul>
            <p className="sample-foot">3 possibly better deals nearby →</p>
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

        <section id="pricing" className="section section-alt">
          <div className="wrap">
            <h2 className="section-title">Simple pricing</h2>
            <p className="section-sub">Pay as you go, or save with a monthly plan.</p>
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
                  {/* Plain <a>: checkout is a server redirect to Stripe, not a page. */}
                  <a href={p.href} className={`btn${p.featured ? "" : " btn-ghost"}`}>
                    {p.cta}
                  </a>
                  {p.note && <p className="plan-note">{p.note}</p>}
                </div>
              ))}
            </div>
            <p className="pricing-demo">
              Not sure yet? <Link href="/results?demo=1">Try a real search free</Link>. We pick a new address every
              week.
            </p>
            <p className="pricing-demo">
              Cancel plans anytime. See our <Link href="/refunds">refund policy</Link>.
            </p>
          </div>
        </section>

        <section className="section">
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

        <section id="compared" className="section section-alt">
          <div className="wrap">
            <h2 className="section-title">Everything that matters, compared</h2>
            <p className="section-sub">
              Comp&apos;d looks well beyond the price tag, using public data and each home&apos;s own listing. You
              choose which of these count, as must-haves or nice-to-haves.
            </p>
            <ul className="categories">
              {categories.map((c) => (
                <li key={c.name}>
                  <strong>{c.name}</strong>
                  <span>{c.detail}</span>
                  <small>{c.source}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="wrap closing">
          <h2>Your next home should be a sure thing.</h2>
          <p>Compare it before you commit.</p>
          <Link href="/results?demo=1" className="btn">
            Try Comp&apos;d free
          </Link>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span className="logo">Comp&apos;d</span>
          <span className="footer-links">
            <Link href="/refunds">Refund policy</Link>
            <Link href="/refunds#contact">Contact</Link>
            <span>Sara Petollari</span>
          </span>
        </div>
      </footer>
    </>
  );
}
