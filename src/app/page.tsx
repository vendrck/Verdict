import Link from "next/link";

const STEPS = [
  { title: "Agree", body: "AI turns the job brief into acceptance criteria both sides can check." },
  { title: "Fund", body: "The client's PayPal payment is authorized and held — not charged yet." },
  { title: "Verify", body: "AI checks the delivered work against every criterion, with reasons." },
  { title: "Release", body: "An admin approves; PayPal captures and the freelancer is paid out." },
  { title: "Defend", body: "Appeals and PayPal disputes get a drafted response from the evidence trail." },
];

export default function HomePage() {
  return (
    <main className="container">
      <header className="hero">
        <p className="eyebrow">PayPal AI Hackathon</p>
        <h1>ProofPay</h1>
        <p className="lede">Escrow for freelance work. AI verifies the delivery; PayPal holds and releases the money.</p>
        <div className="hero-cta">
          <Link className="btn btn-primary" href="/jobs/new">
            Start a job
          </Link>
          <Link className="btn btn-secondary" href="/jobs">
            View jobs
          </Link>
        </div>
      </header>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="step-number">{i + 1}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
