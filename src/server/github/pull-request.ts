import { Octokit } from "@octokit/rest";

/**
 * Evidence about a submitted pull request, frozen at submission time
 * (stored in `submissions.snapshot`). Everything in here except `ci` was written
 * by the freelancer and is untrusted input to the model.
 */
export interface PrSnapshot {
  url: string;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  files: PrFile[];
  /** True if any patch was cut to fit the budget; the verdict then goes to a human. */
  truncated: boolean;
  ci: CiSummary;
  fetchedAt: string;
}

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff for this file; absent for binary files or when GitHub omits it. */
  patch?: string;
  patchTruncated: boolean;
}

export type CiState = "passed" | "failed" | "pending" | "none";

export interface CiSummary {
  state: CiState;
  checks: { name: string; status: string; conclusion: string | null }[];
}

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } {
  const match = PR_URL.exec(url.trim());
  if (!match) throw new Error(`Not a GitHub pull request URL: ${url}`);
  const [, owner, repo, number] = match as unknown as [string, string, string, string];
  return { owner, repo, number: Number(number) };
}

const PASSING = new Set(["success", "neutral", "skipped"]);

/** Reduce check runs to one state. Deterministic: the model never decides CI. */
export function summarizeChecks(checks: CiSummary["checks"]): CiState {
  if (checks.length === 0) return "none";
  if (checks.some((c) => c.status === "completed" && !PASSING.has(c.conclusion ?? ""))) return "failed";
  if (checks.some((c) => c.status !== "completed")) return "pending";
  return "passed";
}

export const PATCH_BUDGET = { perFile: 20_000, total: 150_000 } as const;

export async function fetchPrSnapshot(url: string, token?: string): Promise<PrSnapshot> {
  const { owner, repo, number } = parsePrUrl(url);
  const octokit = new Octokit(token ? { auth: token } : {});

  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
  const rawFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: number,
    per_page: 100,
  });
  const { data: checkRuns } = await octokit.rest.checks.listForRef({
    owner,
    repo,
    ref: pr.head.sha,
    per_page: 100,
  });

  let budget: number = PATCH_BUDGET.total;
  let truncated = false;
  const files: PrFile[] = rawFiles.map((f) => {
    const limit = Math.max(0, Math.min(PATCH_BUDGET.perFile, budget));
    const patchTruncated = f.patch !== undefined && f.patch.length > limit;
    const patch = f.patch?.slice(0, limit);
    budget -= patch?.length ?? 0;
    truncated ||= patchTruncated;
    return {
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch,
      patchTruncated,
    };
  });

  const checks = checkRuns.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));

  return {
    url,
    owner,
    repo,
    number,
    headSha: pr.head.sha,
    title: pr.title,
    body: pr.body ?? "",
    state: pr.state,
    merged: pr.merged,
    files,
    truncated,
    ci: { state: summarizeChecks(checks), checks },
    fetchedAt: new Date().toISOString(),
  };
}
