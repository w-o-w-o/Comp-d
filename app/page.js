const steps = [
  {
    title: "Enter an address",
    text: "Type in the house or rental you're interested in.",
  },
  {
    title: "Pick your area",
    text: "Choose how far around it Comp'd should look for comparable homes.",
  },
  {
    title: "Set your priorities",
    text: "Optionally weight what matters most to you — price, space, location, amenities.",
  },
  {
    title: "Get a verdict",
    text: "Comp'd tells you whether it's worth it, and why.",
  },
];

export default function Home() {
  return (
    <main className="page">
      <header className="hero">
        <p className="brand">Comp&apos;d</p>
        <h1>Know if it&apos;s worth it before you sign.</h1>
        <p className="lede">
          Comp&apos;d compares any house or rental you&apos;re eyeing against
          similar homes in the area you choose, then tells you plainly whether
          it&apos;s a good deal. Care more about square footage than commute?
          Tell Comp&apos;d what to prioritize and the verdict adjusts to you.
        </p>
      </header>

      <section className="steps" aria-label="How it works">
        {steps.map((step, i) => (
          <div className="step" key={step.title}>
            <span className="step-num">{i + 1}</span>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
          </div>
        ))}
      </section>

      <footer className="credit">Sara Petollari</footer>
    </main>
  );
}
