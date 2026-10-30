"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { InvalidTransitionError } from "@/server/escrow/state-machine";
import { createJob, JobError, removeCriterion, runVerification, startFunding, submitWork } from "@/server/jobs/service";
import { fileAppeal } from "@/server/jobs/settlement";

const newJobSchema = z.object({
  title: z.string().trim().min(3, "Title is too short").max(120),
  brief: z.string().trim().min(20, "Describe the work in at least a sentence or two").max(5000),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Amount must look like 100 or 99.50"),
  currency: z.enum(["USD", "EUR", "GBP"]),
  clientEmail: z.email("Client email is invalid"),
  freelancerPaypalEmail: z.email("Freelancer PayPal email is invalid"),
  repoUrl: z.union([z.literal(""), z.url().startsWith("https://github.com/", "Repository must be on github.com")]),
});

/** Turn known, user-facing failures into a message; let real bugs surface. */
function messageFor(err: unknown): string {
  if (err instanceof JobError || err instanceof InvalidTransitionError) return err.message;
  if (err instanceof Error && /pull request URL/.test(err.message)) return err.message;
  console.error(err);
  return "Something went wrong. Check the server log.";
}

const back = (path: string, error: string): never => redirect(`${path}?error=${encodeURIComponent(error)}`);

export async function createJobAction(formData: FormData) {
  const parsed = newJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return back("/jobs/new", parsed.error.issues[0]?.message ?? "Invalid input");

  let jobId: string;
  try {
    jobId = await createJob(parsed.data);
  } catch (err) {
    return back("/jobs/new", messageFor(err));
  }
  redirect(`/jobs/${jobId}`);
}

export async function removeCriterionAction(jobId: string, criterionId: string) {
  try {
    await removeCriterion(jobId, criterionId);
  } catch (err) {
    return back(`/jobs/${jobId}`, messageFor(err));
  }
  redirect(`/jobs/${jobId}`);
}

export async function fundAction(jobId: string) {
  let url: string;
  try {
    url = await startFunding(jobId);
  } catch (err) {
    return back(`/jobs/${jobId}`, messageFor(err));
  }
  redirect(url); // to PayPal; it returns to /jobs/[id]/funded
}

export async function submitWorkAction(jobId: string, formData: FormData) {
  const prUrl = String(formData.get("prUrl") ?? "").trim();
  try {
    await submitWork(jobId, prUrl);
  } catch (err) {
    return back(`/jobs/${jobId}`, messageFor(err));
  }
  redirect(`/jobs/${jobId}`);
}

export async function retryVerificationAction(jobId: string) {
  try {
    await runVerification(jobId);
  } catch (err) {
    return back(`/jobs/${jobId}`, messageFor(err));
  }
  redirect(`/jobs/${jobId}`);
}

const appealSchema = z.object({
  raisedBy: z.enum(["client", "freelancer"]),
  reason: z.string().trim().min(20, "Explain the appeal in at least a sentence").max(3000),
});

export async function fileAppealAction(jobId: string, formData: FormData) {
  const parsed = appealSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return back(`/jobs/${jobId}`, parsed.error.issues[0]?.message ?? "Invalid appeal");
  try {
    await fileAppeal(jobId, parsed.data.raisedBy, parsed.data.reason);
  } catch (err) {
    return back(`/jobs/${jobId}`, messageFor(err));
  }
  redirect(`/jobs/${jobId}`);
}
