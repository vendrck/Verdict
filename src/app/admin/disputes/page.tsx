import Link from "next/link";
import { SubmitButton } from "@/app/jobs/submit-button";
import { requireAdmin } from "@/server/admin/auth";
import { listDisputeRows, type StoredDraft } from "@/server/disputes/service";
import { syncDisputesAction } from "../actions";

export const dynamic = "force-dynamic";

const READABLE_REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
};

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; synced?: string }>;
}) {
  await requireAdmin();
  const [{ error, synced }, rows] = await Promise.all([searchParams, listDisputeRows()]);

  return (
    <main className="container">
      <Link href="/admin" className="back">
        ← Admin queue
      </Link>
      <div className="page-head">
        <h1>PayPal disputes</h1>
        <form action={syncDisputesAction}>
          <SubmitButton variant="secondary" pending="Syncing and drafting…">
            Sync from PayPal
          </SubmitButton>
        </form>
      </div>
      <p className="muted">
        Claims buyers filed with PayPal after money was released. The copilot drafts each response from the audit trail;
        nothing reaches PayPal until you submit it.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {synced && (
        <p className="alert">
          Synced {synced} dispute(s) from the last 30 days. The copilot drafts new ones in the background; refresh in a
          few minutes.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="muted">No disputes yet.</p>
      ) : (
        <ul className="list">
          {rows.map((d) => {
            const draft = d.copilotDraft as StoredDraft | null;
            return (
              <li key={d.id}>
                <Link href={`/admin/disputes/${d.id}`} className="list-row">
                  <span className="list-title">
                    <span className="mono">{d.paypalDisputeId}</span>
                    <span className="hint">
                      {" "}
                      · {READABLE_REASON[d.reason ?? ""] ?? d.reason} · {d.jobId ? "linked to a job" : "no matching job"}
                    </span>
                  </span>
                  <span className="list-meta">
                    {d.decision !== "pending"
                      ? "answered"
                      : draft
                        ? `draft: ${draft.action.replace("_", " ")}`
                        : "no draft yet"}
                  </span>
                  <span className={`badge badge-${d.decision === "pending" ? "warn" : "good"}`}>{d.status}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
