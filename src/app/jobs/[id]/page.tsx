import Link from "next/link";
import { notFound } from "next/navigation";
import { decideAppealAction, retryPayoutAction, settleAction } from "@/app/admin/actions";
import { DecisionForm } from "@/app/admin/decision-form";
import { isAdmin } from "@/server/admin/auth";
import type { AppealRuling } from "@/server/ai/appeal";
import type { Verification } from "@/server/ai/verify";
import { formatMoney } from "@/server/escrow/money";
import type { PrSnapshot } from "@/server/github/pull-request";
import { getJobView, JobError, jobMoney } from "@/server/jobs/service";
import { pendingAppeal } from "@/server/jobs/settlement";
import { fileAppealAction, fundAction, removeCriterionAction, retryVerificationAction, submitWorkAction } from "../actions";
import { StatusBadge } from "../status-badge";
import { SubmitButton } from "../submit-button";

export const dynamic = "force-dynamic";

const CHECK_LABEL = { ci_pass: "CI", diff_matches: "Code", manual: "Manual" } as const;

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; funding?: string }>;
}) {
  const [{ id }, { error, funding }] = await Promise.all([params, searchParams]);
  const view = await getJobView(id).catch((err: unknown) => {
    if (err instanceof JobError) notFound();
    throw err;
  });
  const { job, criteria, latestSubmission, verdict, events } = view;
  const [admin, appeal] = await Promise.all([isAdmin(), pendingAppeal(job.id)]);
  const ruling = appeal?.copilotRuling as (AppealRuling & { model?: string }) | null | undefined;
  const canDecide = job.status === "verified" || job.status === "needs_review";
  const canAppeal = job.status === "verified" || job.status === "rejected" || job.status === "needs_review";
  const amount = `${formatMoney(jobMoney(job))} ${job.currency}`;
  const verification = verdict?.results as Verification | undefined;
  const snapshot = latestSubmission?.snapshot as PrSnapshot | undefined;
  const criterionText = new Map(criteria.map((c, i) => [c.id, { n: i + 1, text: c.text }]));

  return (
    <main className="container">
      <Link href="/jobs" className="back">
        ← Jobs
      </Link>
      <div className="page-head">
        <h1>{job.title}</h1>
        <StatusBadge status={job.status} />
      </div>
      <p className="amount">{amount}</p>
      {error && <p className="alert alert-error">{error}</p>}
      {funding === "cancelled" && <p className="alert">PayPal checkout was cancelled. Nothing was charged.</p>}

      <section className="card">
        <h2>Brief</h2>
        <p className="prewrap">{job.brief}</p>
      </section>

      <section className="card">
        <h2>Acceptance criteria</h2>
        <p className="muted small">
          Drafted by AI from the brief.{" "}
          {job.status === "draft" ? "Remove anything you don't agree with before funding." : "Frozen once funded."}
        </p>
        <ol className="criteria">
          {criteria.map((c) => (
            <li key={c.id}>
              <span className={`tag tag-${c.check}`}>{CHECK_LABEL[c.check]}</span>
              <span className="criterion-text">{c.text}</span>
              {job.status === "draft" && criteria.length > 1 && (
                <form action={removeCriterionAction.bind(null, job.id, c.id)}>
                  <SubmitButton variant="link" pending="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ol>
      </section>

      {(job.status === "draft" || job.status === "awaiting_payment") && (
        <section className="card">
          <h2>Fund the escrow</h2>
          <p className="muted">
            PayPal places a hold of {amount} on the client&apos;s account. Nothing is charged until the work is verified and
            released.
          </p>
          <form action={fundAction.bind(null, job.id)}>
            <SubmitButton pending="Opening PayPal…">
              {job.status === "awaiting_payment" ? "Continue to PayPal" : "Fund with PayPal"}
            </SubmitButton>
          </form>
        </section>
      )}

      {job.authorizationId && (
        <section className="card">
          <h2>Escrow hold</h2>
          <dl className="facts">
            <dt>Authorization</dt>
            <dd className="mono">{job.authorizationId}</dd>
            {job.reauthorizationId && (
              <>
                <dt>Renewed hold</dt>
                <dd className="mono">
                  {job.reauthorizationId} · {job.reauthorizedAt?.toLocaleDateString()}
                </dd>
              </>
            )}
            {job.authorizationExpiresAt && (
              <>
                <dt>Hold expires</dt>
                <dd>{job.authorizationExpiresAt.toLocaleDateString()}</dd>
              </>
            )}
          </dl>
          {job.status === "hold_expired" && (
            <p className="alert">
              The PayPal hold expired before the job was settled, so the client was never charged. To continue, create a
              new job and fund it again.
            </p>
          )}
        </section>
      )}

      {(job.status === "funded" || job.status === "rejected") && (
        <section className="card">
          <h2>{job.status === "rejected" ? "Resubmit work" : "Submit work"}</h2>
          <form action={submitWorkAction.bind(null, job.id)} className="form">
            <label>
              Pull request URL
              <input name="prUrl" type="url" required placeholder="https://github.com/acme/site/pull/42" />
            </label>
            <SubmitButton pending="Fetching PR and verifying…">Submit for verification</SubmitButton>
          </form>
        </section>
      )}

      {job.status === "submitted" && (
        <section className="card">
          <h2>Verification pending</h2>
          <p className="muted">The work is saved. If verification didn&apos;t finish, run it again.</p>
          <form action={retryVerificationAction.bind(null, job.id)}>
            <SubmitButton pending="Verifying…">Retry verification</SubmitButton>
          </form>
        </section>
      )}

      {verification && verdict && (
        <section className="card">
          <div className="section-head">
            <h2>AI verdict</h2>
            <span className={`badge badge-${verdict.overall === "pass" ? "good" : verdict.overall === "fail" ? "bad" : "warn"}`}>
              {verdict.overall.toUpperCase()}
            </span>
          </div>
          {snapshot && (
            <p className="muted small">
              <a href={snapshot.url} target="_blank" rel="noreferrer">
                {snapshot.owner}/{snapshot.repo}#{snapshot.number}
              </a>{" "}
              · {snapshot.files.length} files · CI {snapshot.ci.state} · {verdict.model}
            </p>
          )}
          <ul className="results">
            {verification.results.map((r) => {
              const c = criterionText.get(r.criterionId);
              return (
                <li key={r.criterionId} className={`result result-${r.verdict}`}>
                  <div className="result-head">
                    <strong>
                      {c ? `${c.n}. ${c.text}` : r.criterionId}
                    </strong>
                    <span className="small muted">
                      {r.verdict} · {Math.round(r.confidence * 100)}% · {r.decidedBy}
                    </span>
                  </div>
                  <p>{r.reasoning}</p>
                </li>
              );
            })}
          </ul>
          {verification.reviewReasons.length > 0 && (
            <div className="alert">
              <strong>Sent to admin review:</strong>
              <ul>
                {verification.reviewReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {canAppeal && (
        <section className="card">
          <h2>Disagree with the verdict?</h2>
          <p className="muted small">
            Either party can appeal before money moves. The AI drafts a ruling from the criteria and the evidence; an admin
            makes the final call.
          </p>
          <form action={fileAppealAction.bind(null, job.id)} className="form">
            <label>
              I am the
              <select name="raisedBy" defaultValue="freelancer">
                <option value="freelancer">Freelancer</option>
                <option value="client">Client</option>
              </select>
            </label>
            <label>
              Reason
              <textarea name="reason" rows={4} required minLength={20} placeholder="Which criterion is judged wrongly, and why?" />
            </label>
            <SubmitButton variant="secondary" pending="Filing appeal and drafting a ruling…">
              File appeal
            </SubmitButton>
          </form>
        </section>
      )}

      {appeal && (
        <section className="card">
          <h2>Appeal by the {appeal.raisedBy}</h2>
          <p className="prewrap">{appeal.reason}</p>
          {ruling ? (
            <div className="ruling">
              <div className="section-head">
                <strong>AI draft ruling</strong>
                <span className="badge badge-info">
                  {ruling.outcome} · {ruling.releasePercent}% to freelancer
                </span>
              </div>
              <p>{ruling.rationale}</p>
              {ruling.considerations.length > 0 && (
                <ul className="small muted">
                  {ruling.considerations.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {ruling.model && <p className="small muted">Drafted by {ruling.model}. Awaiting admin decision.</p>}
            </div>
          ) : (
            <p className="muted small">No AI draft available; the admin decides directly.</p>
          )}
        </section>
      )}

      {job.captureId && (
        <section className="card">
          <h2>Settlement</h2>
          <dl className="facts">
            <dt>Released</dt>
            <dd>
              {formatMoney({ currency: job.currency, minor: job.releasedMinor ?? 0 })} {job.currency}
            </dd>
            <dt>Returned to client</dt>
            <dd>
              {formatMoney({ currency: job.currency, minor: job.amountMinor - (job.releasedMinor ?? 0) })} {job.currency}
            </dd>
            <dt>Capture</dt>
            <dd className="mono">{job.captureId}</dd>
            <dt>Payout</dt>
            <dd className="mono">{job.payoutBatchId ?? "not sent yet"}</dd>
          </dl>
        </section>
      )}

      {admin && (canDecide || appeal || (job.captureId && !job.payoutBatchId)) && (
        <section className="card card-admin">
          <h2>Admin decision</h2>
          {appeal ? (
            <DecisionForm
              action={decideAppealAction.bind(null, job.id, appeal.id)}
              defaultPercent={ruling?.releasePercent ?? 100}
              heldLabel={amount}
              submitLabel={ruling ? "Decide appeal" : "Decide appeal (no draft)"}
            />
          ) : canDecide ? (
            <DecisionForm
              action={settleAction.bind(null, job.id)}
              defaultPercent={job.status === "verified" ? 100 : 0}
              heldLabel={amount}
              submitLabel="Settle"
            />
          ) : (
            <form action={retryPayoutAction.bind(null, job.id)}>
              <p className="muted">Funds are captured but the payout didn&apos;t go through.</p>
              <SubmitButton pending="Paying out…">Retry payout</SubmitButton>
            </form>
          )}
        </section>
      )}

      {(job.status === "disputed" || job.status === "dispute_closed") && (
        <section className="card">
          <h2>PayPal dispute</h2>
          <p className="muted">
            {job.status === "disputed"
              ? "The client opened a dispute with PayPal after the release. The copilot drafts a response from this job's audit trail; an admin submits it."
              : "The PayPal dispute on this job is closed."}
          </p>
          {admin && <Link href="/admin/disputes">Open disputes</Link>}
        </section>
      )}

      <section className="card">
        <h2>Audit trail</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="mono small">{e.createdAt.toLocaleString()}</span> <span className="tag">{e.actor}</span>{" "}
              {e.type}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
