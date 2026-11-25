import Link from "next/link";
import Nav from "../Nav";
import { formatCents, PLANS, REANALYSIS_PRICE, SEARCH_PRICE } from "../../lib/plans";

export const metadata = { title: "Refund policy — Comp'd" };

// The public contact address, set in CONTACT_EMAIL (no code change needed).
const contactEmail = (process.env.CONTACT_EMAIL || "").trim();

export default function RefundsPage() {
  return (
    <>
      <Nav />
      <main className="wrap account policy">
        <p className="eyebrow">Policies</p>
        <h1>Refund policy</h1>
        <p className="lede">Last updated November 25, 2026.</p>

        <section className="card">
          <h2>Pay per search ({formatCents(SEARCH_PRICE)}) and AI re-analyses ({formatCents(REANALYSIS_PRICE)})</h2>
          <p>
            These are delivered right away: a search opens its listings for 7 days, and an analysis runs as soon as
            you confirm it. Because of that, they aren&apos;t refundable once delivered. We&apos;ll refund the full
            amount if:
          </p>
          <ul>
            <li>you were charged more than once for the same thing,</li>
            <li>a search you paid for showed no homes, or wouldn&apos;t load, or</li>
            <li>an AI analysis you paid for failed and didn&apos;t run.</li>
          </ul>
          <p>Ask within 14 days of the charge.</p>
        </section>

        <section className="card">
          <h2>
            Monthly plans ({PLANS.basic.name} ${PLANS.basic.price / 100}/mo, {PLANS.advanced.name} $
            {PLANS.advanced.price / 100}/mo)
          </h2>
          <ul>
            <li>
              Cancel anytime from <Link href="/account">My account</Link> → &quot;Change plan or manage
              billing&quot;. You keep the plan until the end of the month you paid for, and you won&apos;t be charged
              again.
            </li>
            <li>We don&apos;t refund part of a month you&apos;ve already started using.</li>
            <li>
              If a monthly renewal went through by mistake and you haven&apos;t run a search since, ask within 7
              days and we&apos;ll refund it and cancel the plan.
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>How refunds are paid</h2>
          <p>
            Refunds go back to the card you paid with. Your bank usually shows them within 5–10 business days.
          </p>
          <p>The weekly free demo is always free; there&apos;s nothing to refund.</p>
        </section>

        <section className="card" id="contact">
          <h2>Contact</h2>
          {contactEmail ? (
            <p>
              Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with the email address on your Comp&apos;d
              account and the date of the charge. We reply within 2 business days.
            </p>
          ) : (
            <p>
              Reply to the receipt email Stripe sent you for the charge, and include the date of the charge. We
              reply within 2 business days.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
