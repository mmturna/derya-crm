import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  INGESTED: { label: "New",    cls: "badge-info" },
  PARSED:   { label: "Parsed", cls: "badge-neutral" },
  PRICED:   { label: "Priced", cls: "badge-warn" },
  QUOTED:   { label: "Quoted", cls: "badge-good" },
  WON:      { label: "Won",    cls: "badge-good" },
  LOST:     { label: "Lost",   cls: "badge-danger" },
};

const NEXT_ACTION: Record<string, string> = {
  INGESTED: "Parse with AI",
  PARSED:   "Add rates",
  PRICED:   "Convert to Job",
  QUOTED:   "Awaiting reply",
};

function timeAgo(date: Date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function RFQPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  const { status } = await searchParams;

  const where: Record<string, unknown> = { officeId: session.officeId };
  if (status) where.status = status;

  const inquiries = await prisma.inquiry.findMany({
    where,
    include: {
      company: { select: { id: true, name: true } },
      job: { select: { id: true, reference: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });

  const allCounts = await prisma.inquiry.groupBy({
    by: ["status"],
    where: { officeId: session.officeId },
    _count: true,
  });

  const countByStatus = Object.fromEntries(
    allCounts.map((r: { status: string; _count: number }) => [r.status, r._count])
  );
  const totalNew = countByStatus["INGESTED"] ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">
            RFQ Inbox
            {totalNew > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--brand)",
                  color: "#fff",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 8px",
                  marginLeft: 10,
                  verticalAlign: "middle",
                }}
              >
                {totalNew}
              </span>
            )}
          </h1>
          <p className="page-subtitle">
            Incoming freight requests — parse, price, and convert to jobs
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/dashboard/settings/email" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Connect Email
          </a>
          <a href="/dashboard/rfq/new" className="btn" style={{ fontSize: 13, textDecoration: "none" }}>
            + Manual Entry
          </a>
        </div>
      </div>

      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { key: "", label: "All", count: inquiries.length },
          { key: "INGESTED", label: "New", count: countByStatus["INGESTED"] ?? 0 },
          { key: "PRICED", label: "Priced", count: countByStatus["PRICED"] ?? 0 },
          { key: "QUOTED", label: "Quoted", count: countByStatus["QUOTED"] ?? 0 },
          { key: "WON", label: "Won", count: countByStatus["WON"] ?? 0 },
          { key: "LOST", label: "Lost", count: countByStatus["LOST"] ?? 0 },
        ].map((tab) => (
          <a
            key={tab.key}
            href={tab.key ? `/dashboard/rfq?status=${tab.key}` : "/dashboard/rfq"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: "var(--radius)",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              background: (status ?? "") === tab.key ? "var(--brand)" : "var(--surface)",
              color: (status ?? "") === tab.key ? "#fff" : "var(--text-2)",
              border: "1px solid",
              borderColor: (status ?? "") === tab.key ? "var(--brand)" : "var(--border)",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: (status ?? "") === tab.key ? "rgba(255,255,255,0.25)" : "var(--surface-3)",
                  borderRadius: 999,
                  padding: "0 6px",
                  color: (status ?? "") === tab.key ? "#fff" : "var(--text-3)",
                }}
              >
                {tab.count}
              </span>
            )}
          </a>
        ))}
      </div>

      {/* RFQ list */}
      {inquiries.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "64px 24px" }}>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 15, marginBottom: 8 }}>
            No RFQs yet
          </div>
          <p style={{ color: "var(--text-3)", fontSize: 13, maxWidth: 380, margin: "0 auto 24px" }}>
            Connect a Gmail or Outlook inbox to automatically capture inbound freight
            requests, or add one manually.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn btn-secondary" style={{ fontSize: 13 }}>
              Connect Gmail
            </button>
            <button className="btn btn-secondary" style={{ fontSize: 13 }}>
              Connect Outlook
            </button>
            <button className="btn" style={{ fontSize: 13 }}>
              + Manual RFQ
            </button>
          </div>
        </div>
      ) : (
        <div className="rfq-list">
          {/* Header row */}
          <div className="rfq-row rfq-row-header">
            <span>From</span>
            <span>Subject</span>
            <span>Route</span>
            <span>Received</span>
            <span>Status</span>
          </div>

          {inquiries.map((inq: typeof inquiries[0]) => {
            const sm = STATUS_META[inq.status] ?? { label: inq.status, cls: "badge-neutral" };
            const route =
              inq.origin && inq.destination
                ? `${inq.origin} → ${inq.destination}`
                : inq.origin ?? inq.destination ?? "—";

            return (
              <a
                key={inq.id}
                href={`/dashboard/rfq/${inq.id}`}
                className="rfq-row"
              >
                <div className="rfq-from">
                  <span>{inq.company?.name ?? inq.fromCompany ?? "Unknown"}</span>
                  {inq.fromEmail && (
                    <span className="rfq-from-sub">{inq.fromEmail}</span>
                  )}
                </div>
                <div className="rfq-subject">{inq.subject}</div>
                <div className="rfq-route">
                  {route !== "—" ? (
                    <>
                      {inq.origin ?? "?"}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      {inq.destination ?? "?"}
                    </>
                  ) : "—"}
                </div>
                <div className="rfq-time">{timeAgo(new Date(inq.receivedAt))}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`badge ${sm.cls}`}>{sm.label}</span>
                  {inq.job ? (
                    <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>
                      {inq.job.reference}
                    </span>
                  ) : NEXT_ACTION[inq.status] ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", whiteSpace: "nowrap" }}>
                      {NEXT_ACTION[inq.status]} →
                    </span>
                  ) : null}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
