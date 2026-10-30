import { SubmitButton } from "@/app/jobs/submit-button";

/**
 * One form for every money decision: release 100%, a partial %, or 0% = refund.
 * Plain HTML (no client JS); the server re-validates everything.
 */
export function DecisionForm({
  action,
  defaultPercent,
  heldLabel,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  defaultPercent: number;
  heldLabel: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="form">
      <label>
        Release to freelancer (% of {heldLabel})
        <input name="releasePercent" type="number" min={0} max={100} step={1} defaultValue={defaultPercent} required />
        <span className="hint">100 = full release · 1–99 = partial (the rest returns to the client) · 0 = refund (void the hold)</span>
      </label>
      <label>
        Note for the audit trail <span className="muted">(optional)</span>
        <input name="note" maxLength={1000} placeholder="Why this decision" />
      </label>
      <label className="checkbox">
        <input name="confirm" type="checkbox" value="yes" required /> I confirm this moves money in PayPal.
      </label>
      <SubmitButton pending="Talking to PayPal…">{submitLabel}</SubmitButton>
    </form>
  );
}
