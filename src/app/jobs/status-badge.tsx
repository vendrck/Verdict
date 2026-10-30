import type { JobStatus } from "@/server/escrow/state-machine";

const LABELS: Record<JobStatus, { label: string; tone: "neutral" | "info" | "good" | "warn" | "bad" }> = {
  draft: { label: "Draft", tone: "neutral" },
  awaiting_payment: { label: "Awaiting payment", tone: "info" },
  funded: { label: "Funded · held", tone: "info" },
  submitted: { label: "Submitted", tone: "info" },
  verified: { label: "Verified", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  needs_review: { label: "Needs review", tone: "warn" },
  appealed: { label: "Appealed", tone: "warn" },
  released: { label: "Released", tone: "good" },
  partially_released: { label: "Partially released", tone: "good" },
  refunded: { label: "Refunded", tone: "neutral" },
  hold_expired: { label: "Hold expired", tone: "bad" },
  disputed: { label: "Disputed", tone: "bad" },
  dispute_closed: { label: "Dispute closed", tone: "neutral" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, tone } = LABELS[status];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
