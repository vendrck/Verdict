import Link from "next/link";
import { after } from "next/server";
import { StatusBadge } from "@/app/jobs/status-badge";
import { requireAdmin } from "@/server/admin/auth";
import { formatMoney } from "@/server/escrow/money";
import { listDisputeRows } from "@/server/disputes/service";
import { adminQueue, checkHolds } from "@/server/jobs/settlement";
import { jobMoney } from "@/server/jobs/store";
import { SubmitButton } from "@/app/jobs/submit-button";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

const WHY: Record<string, string> = {
  verified: "AI passed every criterion: approve the release",
  needs_review: "AI unsure or manual checks: review and decide",
  appealed: "A party appealed: review the drafted ruling",
  released: "Captured, payout pending: retry the payout",
  partially_released: "Captured, payout pending: retry the payout",
};

export default async function AdminPage() {
  await requireAdmin();
  const [{ actionable: queue, expiring }, disputes] = await Promise.all([adminQueue(), listDisputeRows()]);
  // No scheduler needed: each admin visit sweeps for expired holds after the page is sent.
  after(() => checkHolds().catch((err: unknown) => console.error("Hold check failed", err)));
  const openDisputes = disputes.filter((d) => d.decision === "pending").length;
  return (
    <main className="container">
      <div className="page-head">
        <h1>Admin queue</h1>
        <form action={logoutAction}>
          <SubmitButton variant="secondary" pending="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
      <p className="muted">Nothing moves money until you approve it here.</p>
      <p>
        <Link href="/admin/disputes">PayPal disputes</Link>{" "}
        <span className={`badge badge-${openDisputes ? "warn" : "good"}`}>{openDisputes} awaiting a response</span>
      </p>
      {expiring.length > 0 && (
        <section className="card">
          <h2>Holds about to expire</h2>
          <p className="muted small">
            PayPal holds last 29 days. Settle these before then, or the client has to fund the job again.
          </p>
          <ul className="list">
            {expiring.map(({ job, daysLeft, expiresAt }) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="list-row">
                  <span className="list-title">
                    {job.title}
                    <span className="hint"> · expires {expiresAt.toLocaleDateString()}</span>
                  </span>
                  <span className="list-meta">{daysLeft === 0 ? "today" : `${daysLeft} day(s) left`}</span>
                  <StatusBadge status={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {queue.length === 0 ? (
        <p className="muted">Nothing waiting. 🎉</p>
      ) : (
        <ul className="list">
          {queue.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className="list-row">
                <span className="list-title">
                  {job.title}
                  <span className="hint"> · {WHY[job.status]}</span>
                </span>
                <span className="list-meta">
                  {formatMoney(jobMoney(job))} {job.currency}
                </span>
                <StatusBadge status={job.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
