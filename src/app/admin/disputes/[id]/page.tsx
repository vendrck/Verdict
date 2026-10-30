import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/app/jobs/submit-button";
import { requireAdmin } from "@/server/admin/auth";
import { EVIDENCE_NOTES_MAX } from "@/server/ai/dispute";
import { getDisputeView } from "@/server/disputes/service";
import { JobError } from "@/server/jobs/store";
import { redraftDisputeAction, respondDisputeAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function DisputePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; drafting?: string }>;
}) {
  await requireAdmin();
  const [{ id }, { error, drafting }] = await Promise.all([params, searchParams]);
  const view = await getDisputeView(id).catch((err: unknown) => {
    if (err instanceof JobError) notFound();
    throw err;
  });
  const { row, draft, live, job, allowed } = view;
  const pending = row.decision === "pending";
  const evidences = draft?.action === "provide_evidence" ? draft.evidences : [];
  const respond = respondDisputeAction.bind(null, row.id);

  return (
    <main className="container">
      <Link href="/admin/disputes" className="back">
        ← Disputes
      </Link>
      <div className="page-head">
        <h1 className="mono">{row.paypalDisputeId}</h1>
        <span className={`badge badge-${pending ? "warn" : "good"}`}>{live?.status ?? row.status}</span>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {drafting && (
        <p className="alert">
          The copilot is investigating and drafting in the background. This can take a few minutes; refresh to see it.
        </p>
      )}

      <section className="card">
        <h2>Claim</h2>
        <dl className="facts">
          <dt>Reason</dt>
          <dd>{row.reason}</dd>
          <dt>Stage</dt>
          <dd>{live?.dispute_life_cycle_stage ?? "unknown"}</dd>
          <dt>Amount</dt>
          <dd>{live?.dispute_amount ? `${live.dispute_amount.value} ${live.dispute_amount.currency_code}` : "unknown"}</dd>
          <dt>Respond by</dt>
          <dd>{row.responseDueAt?.toLocaleString() ?? "unknown"}</dd>
          <dt>Job</dt>
          <dd>{job ? <Link href={`/jobs/${job.id}`}>{job.title}</Link> : "No job matches the disputed transaction"}</dd>
        </dl>
        {(live?.messages ?? []).length > 0 && (
          <>
            <h3>Buyer messages</h3>
            <ul className="small">
              {live!.messages!.map((m) => (
                <li key={m.time_posted + m.content.slice(0, 20)}>
                  <span className="muted">{new Date(m.time_posted).toLocaleString()} · {m.posted_by}:</span> {m.content}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Copilot draft</h2>
          {draft && <span className="badge badge-info">recommends: {draft.action.replace("_", " ")}</span>}
        </div>
        {draft ? (
          <div className="ruling">
            <p>{draft.rationale}</p>
            {draft.risks.length > 0 && (
              <>
                <strong className="small">Weak points</strong>
                <ul className="small muted">
                  {draft.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="small muted">
              Drafted by {draft.model} {draft.investigated ? "after checking PayPal through MCP" : "from platform records only"}{" "}
              · {new Date(draft.draftedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="muted">No draft yet.</p>
        )}
        {pending && (
          <form action={redraftDisputeAction.bind(null, row.id)}>
            <SubmitButton variant="secondary" pending="Starting…">
              {draft ? "Redraft" : "Draft a response"}
            </SubmitButton>
          </form>
        )}
      </section>

      {pending ? (
        <section className="card card-admin">
          <h2>Respond in PayPal</h2>
          <p className="muted small">
            Edit the copilot&apos;s text, then submit one response. PayPal currently allows:{" "}
            {allowed.length ? allowed.map((a) => a.replace("_", " ")).join(", ") : "neither action"}.
          </p>

          {allowed.includes("provide_evidence") && (
            <form action={respond} className="form">
              <input type="hidden" name="action" value="provide_evidence" />
              <h3>Contest with evidence{draft?.action === "provide_evidence" && " (recommended)"}</h3>
              {(evidences.length ? evidences : [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: "" }]).map((e, i) => (
                <label key={i}>
                  <input type="hidden" name="evidenceType" value={e.evidence_type} />
                  {e.evidence_type.replaceAll("_", " ").toLowerCase()}
                  <textarea name="evidenceNote" rows={5} maxLength={EVIDENCE_NOTES_MAX} defaultValue={e.notes} />
                </label>
              ))}
              <label className="checkbox">
                <input name="confirm" type="checkbox" value="yes" required /> I reviewed this and want to submit it to PayPal.
              </label>
              <SubmitButton pending="Submitting evidence…">Submit evidence</SubmitButton>
            </form>
          )}

          {allowed.includes("accept_claim") && (
            <form action={respond} className="form">
              <input type="hidden" name="action" value="accept_claim" />
              <h3>Accept the claim{draft?.action === "accept_claim" && " (recommended)"}</h3>
              <p className="muted small">PayPal refunds the buyer from the business account.</p>
              <label>
                Note to the buyer
                <textarea name="claimNote" rows={3} maxLength={2000} defaultValue={draft?.claimNote ?? ""} />
              </label>
              <label className="checkbox">
                <input name="confirm" type="checkbox" value="yes" required /> I understand this refunds the buyer.
              </label>
              <SubmitButton variant="secondary" pending="Accepting claim…">
                Accept claim
              </SubmitButton>
            </form>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>Answered</h2>
          <p>
            Submitted {row.submittedAt?.toLocaleString()} ·{" "}
            {row.decision === "approved" ? "copilot draft sent as written" : "edited by the admin before sending"}.
          </p>
        </section>
      )}
    </main>
  );
}
