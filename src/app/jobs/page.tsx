import Link from "next/link";
import { formatMoney } from "@/server/escrow/money";
import { jobMoney, listJobs } from "@/server/jobs/service";
import { StatusBadge } from "./status-badge";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const jobs = await listJobs();
  return (
    <main className="container">
      <div className="page-head">
        <h1>Jobs</h1>
        <Link className="btn btn-primary" href="/jobs/new">
          New job
        </Link>
      </div>
      {jobs.length === 0 ? (
        <p className="muted">No jobs yet. Create one to try the escrow flow.</p>
      ) : (
        <ul className="list">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className="list-row">
                <span className="list-title">{job.title}</span>
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
