import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getFocusedJobId } from "@/lib/job-focus";
import { Icon } from "@/components/icon";
import { JobConfirmActions } from "@/components/job-confirm-button";

const STATUSES = [
  { key: "PROPOSED",   label: "Proposed"   },
  { key: "INQUIRY",    label: "Inquiry"    },
  { key: "QUOTED",     label: "Quoted"     },
  { key: "BOOKED",     label: "Booked"     },
  { key: "IN_TRANSIT", label: "In Transit" },
  { key: "CUSTOMS",    label: "Customs"    },
  { key: "DELIVERED",  label: "Delivered"  },
] as const;

// Same underlying statuses, but labels reframed for procurement (SOURCING).
const PROCUREMENT_LABELS: Record<string, string> = {
  PROPOSED:   "Proposed",
  INQUIRY:    "Negotiating",
  QUOTED:     "Award pending",
  BOOKED:     "Awarded",
  IN_TRANSIT: "Shipping",
  CUSTOMS:    "In transit",
  DELIVERED:  "Received",
};

type StatusKey = typeof STATUSES[number]["key"];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const session = await requireSession();
  const { mode } = await searchParams;
  const focusedId = await getFocusedJobId();

  const typeFilter =
    mode === "procurement" ? "SOURCING" :
    mode === "operations"  ? "FORWARDING" : null;

  const jobs = await prisma.job.findMany({
    where: {
      officeId: session.officeId,
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    include: {
      company: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const isProcurement = mode === "procurement";

  const byStatus: Record<StatusKey, typeof jobs> = {
    PROPOSED: [], INQUIRY: [], QUOTED: [], BOOKED: [], IN_TRANSIT: [], CUSTOMS: [], DELIVERED: [],
  };
  for (const j of jobs) {
    if (j.status in byStatus) byStatus[j.status as StatusKey].push(j);
  }

  const activeCount = jobs.filter(
    (j) => !["DELIVERED", "CANCELLED"].includes(j.status)
  ).length;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Pipeline
            <span className="live-dot" aria-hidden />
          </h1>
          <p className="page-subtitle">{activeCount} active jobs flowing · {jobs.length} total</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mode-tabs">
            <Link href="/dashboard/jobs" className={`mode-tab${!mode ? " active" : ""}`}>All</Link>
            <Link href={"/dashboard/jobs?mode=procurement" as "/dashboard/jobs"} className={`mode-tab${mode === "procurement" ? " active" : ""}`}>
              <Icon name="box" size={13} />
              Procurement
            </Link>
            <Link href={"/dashboard/jobs?mode=operations" as "/dashboard/jobs"} className={`mode-tab${mode === "operations" ? " active" : ""}`}>
              <Icon name="truck" size={13} />
              Operations
            </Link>
          </div>
          <Link href="/dashboard/rfq" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none" }}>
            From RFQ
          </Link>
          <a href="/dashboard/jobs/new" className="btn" style={{ fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={13} strokeWidth={2.5} /> New Job
          </a>
        </div>
      </div>

      {/* Stats strip */}
      <div className="metric-strip" style={{ marginBottom: 16 }}>
        {STATUSES.filter((s) => s.key !== "DELIVERED").map((s) => (
          <div key={s.key} className="metric-item">
            <div className="metric-label">{isProcurement ? (PROCUREMENT_LABELS[s.key] ?? s.label) : s.label}</div>
            <div className="metric-value">{byStatus[s.key].length}</div>
          </div>
        ))}
      </div>

      {/* Kanban board */}
      <div className="job-board">
        {STATUSES.map((status) => {
          const colJobs = byStatus[status.key];
          return (
            <div key={status.key} className="job-col">
              <div className="job-col-header">
                <div className="job-col-title">{isProcurement ? (PROCUREMENT_LABELS[status.key] ?? status.label) : status.label}</div>
                <span className="job-col-count">{colJobs.length}</span>
              </div>
              <div className="job-col-body">
                {colJobs.length === 0 ? (
                  <div className="job-col-empty">—</div>
                ) : (
                  colJobs.map((job) => (
                    <a
                      key={job.id}
                      href={`/dashboard/jobs/${job.id}`}
                      className={`job-card${focusedId === job.id ? " focus-match" : ""}`}
                      style={job.status === "PROPOSED" ? { borderStyle: "dashed", borderColor: "var(--brand)", background: "var(--surface)" } : undefined}
                    >
                      <div className="job-card-ref" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {job.reference}
                        {job.status === "PROPOSED" && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                            background: "var(--brand-light)", color: "var(--brand)",
                            border: "1px solid var(--brand-border)",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                          }}>DRAFT</span>
                        )}
                      </div>
                      <div className="job-card-company">{job.company?.name ?? "—"}</div>
                      <div className="job-card-route">
                        {job.origin && job.destination ? (
                          <>{job.origin} → {job.destination}</>
                        ) : "Route TBD"}
                      </div>
                      <div className="job-card-footer">
                        {job.mode && <span className="job-mode-chip">{job.mode}</span>}
                        {job.eta && (
                          <span className="job-eta">
                            ETA {new Date(job.eta).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        )}
                      </div>
                      {job.status === "PROPOSED" && <JobConfirmActions jobId={job.id} />}
                    </a>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {jobs.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "60px 24px", marginTop: 8 }}>
          <Icon name="box" size={36} style={{ opacity: 0.2 }} />
          <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 12, marginBottom: 6 }}>No jobs yet</div>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 20 }}>
            Jobs are created when an RFQ is converted, or manually added.
          </p>
          <Link href="/dashboard/rfq" className="btn" style={{ display: "inline-flex" }}>
            Go to RFQ Inbox
          </Link>
        </div>
      )}
    </div>
  );
}
