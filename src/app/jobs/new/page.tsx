import Link from "next/link";
import { createJobAction } from "../actions";
import { SubmitButton } from "../submit-button";

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // Dev convenience: prefill the sandbox test accounts so a demo job can't pay a made-up address.
  const dev = process.env.NODE_ENV !== "production";
  const defaults = {
    clientEmail: dev ? process.env.SPIKE_CLIENT_EMAIL : undefined,
    freelancerEmail: dev ? process.env.SPIKE_FREELANCER_EMAIL : undefined,
  };
  return (
    <main className="container">
      <Link href="/jobs" className="back">
        ← Jobs
      </Link>
      <h1>New job</h1>
      <p className="muted">
        Describe the work. The AI turns the brief into acceptance criteria you can review before paying anything.
      </p>
      {error && <p className="alert alert-error">{error}</p>}

      <form action={createJobAction} className="form">
        <label>
          Title
          <input name="title" required maxLength={120} placeholder="Dark mode for the marketing site" />
        </label>
        <label>
          Brief
          <textarea
            name="brief"
            required
            rows={6}
            placeholder="Add a dark mode toggle to the navbar. Theme colours must cover cards and buttons. All CI checks must pass."
          />
        </label>
        <div className="row">
          <label>
            Amount
            <input name="amount" required inputMode="decimal" placeholder="100.00" />
          </label>
          <label>
            Currency
            <select name="currency" defaultValue="USD">
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
            </select>
          </label>
        </div>
        <label>
          Client email
          <input name="clientEmail" type="email" required defaultValue={defaults.clientEmail} />
        </label>
        <label>
          Freelancer PayPal email
          <input name="freelancerPaypalEmail" type="email" required defaultValue={defaults.freelancerEmail} />
          <span className="hint">Payouts go here once the work is released.</span>
        </label>
        <label>
          GitHub repository <span className="muted">(optional)</span>
          <input name="repoUrl" type="url" placeholder="https://github.com/acme/site" />
        </label>
        <SubmitButton pending="Drafting criteria…">Create job</SubmitButton>
      </form>
    </main>
  );
}
