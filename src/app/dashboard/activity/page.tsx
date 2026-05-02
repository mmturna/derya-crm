import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Icon } from "@/components/icon";

const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "Inquiry", QUOTED: "Quoted", BOOKED: "Booked",
  IN_TRANSIT: "In Transit", CUSTOMS: "Customs", DELIVERED: "Delivered",
};

const RFQ_NEXT: Record<string, string> = {
  INGESTED: "Parse with AI",
  PARSED:   "Request carrier rates",
  PRICED:   "Convert to Job",
  QUOTED:   "Awaiting reply",
};

const MILESTONE_LABEL: Record<string, string> = {
  BOOKING: "Booking", CARGO_READY: "Cargo Ready", ETD: "ETD",
  ETA: "ETA", CUSTOMS_ENTRY: "Customs", CUSTOMS_RELEASE: "Cleared", DELIVERY: "Delivery",
};

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function relDays(d: Date) {
  const ms = new Date(d).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < -1) return `${Math.abs(days)}d ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

function StatusPill({ s }: { s: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 3,
      background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)",
      textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{STATUS_LABEL[s] ?? s}</span>
  );
}

function SectionCard({
  title, count, action, children,
}: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card" style={{ marginBottom: 14, overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="section-title" style={{ margin: 0 }}>{title}</span>
          {count != null && (
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 3, background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)" }}>
              {count}
            </span>
          )}
        </div>
        {action}
      </header>
      <div>{children}</div>
    </section>
  );
}

export default async function ActivityPage() {
  const session = await requireSession();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const in3 = new Date(today.getTime() + 3 * 86_400_000);

  const [
    rfqsToParse,
    rfqsToPrice,
    rfqsToConvert,
    overdueJobs,
    jobsMissingRates,
    upcomingMilestones,
    pendingDocs,
    activeJobsCount,
    inTransitValue,
  ] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: session.officeId, status: "INGESTED" },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.inquiry.findMany({
      where: { officeId: session.officeId, status: "PARSED" },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.inquiry.findMany({
      where: { officeId: session.officeId, status: "PRICED", job: null },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.job.findMany({
      where: {
        officeId: session.officeId,
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        eta: { lt: today },
      },
      include: { company: { select: { name: true } } },
      orderBy: { eta: "asc" },
      take: 8,
    }),
    prisma.job.findMany({
      where: {
        officeId: session.officeId,
        status: { in: ["INQUIRY", "QUOTED"] },
        cost: null,
      },
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.jobMilestone.findMany({
      where: {
        actualAt: null,
        plannedAt: { gte: today, lte: in7 },
        job: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      },
      include: { job: { include: { company: { select: { name: true } } } } },
      orderBy: { plannedAt: "asc" },
      take: 10,
    }),
    prisma.jobDocument.findMany({
      where: {
        officeId: session.officeId,
        status: "PENDING",
        job: { status: { in: ["BOOKED", "IN_TRANSIT", "CUSTOMS"] } },
      },
      include: { job: { select: { id: true, reference: true, status: true } } },
      take: 10,
    }),
    prisma.job.count({
      where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    }),
    prisma.job.aggregate({
      where: { officeId: session.officeId, status: { in: ["IN_TRANSIT", "CUSTOMS"] } },
      _sum: { revenue: true },
    }),
  ]);

  const totalAttention =
    rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length +
    overdueJobs.length + jobsMissingRates.length + upcomingMilestones.length;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Operations Command</h1>
          <p className="page-subtitle">
            {totalAttention === 0
              ? "Everything's on track. No items need your attention."
              : `${totalAttention} items need attention across RFQs, procurement, and shipments`}
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
        {[
          { label: "Active Jobs",       value: activeJobsCount,  color: "var(--text)" },
          { label: "In-Transit Value",  value: `$${(inTransitValue._sum.revenue ?? 0).toLocaleString()}`, color: "var(--text)" },
          { label: "RFQs to Process",   value: rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length, color: "var(--brand)" },
          { label: "Past ETA",          value: overdueJobs.length, color: overdueJobs.length > 0 ? "var(--danger)" : "var(--text-3)" },
        ].map((k) => (
          <div key={k.label} className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* RFQ pipeline — three-column flow */}
      {(rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length) > 0 && (
        <SectionCard
          title="RFQ Pipeline"
          count={rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length}
          action={<a href="/dashboard/rfq" style={{ fontSize: 12, color: "var(--brand)", fontWeight: 500, textDecoration: "none" }}>Open inbox →</a>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
            {[
              { title: "01 · To Parse",   items: rfqsToParse,   stage: "INGESTED" },
              { title: "02 · To Price",   items: rfqsToPrice,   stage: "PARSED" },
              { title: "03 · To Convert", items: rfqsToConvert, stage: "PRICED" },
            ].map((col, idx) => (
              <div key={col.title} style={{ borderRight: idx < 2 ? "1px solid var(--border)" : "none", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{col.title}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}>{col.items.length}</span>
                </div>
                {col.items.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-3)", padding: "10px 0" }}>None pending</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {col.items.map((inq) => (
                      <a key={inq.id} href={`/dashboard/rfq/${inq.id}`} style={{
                        display: "block", padding: "9px 10px", borderRadius: 5,
                        border: "1px solid var(--border)", background: "var(--surface)",
                        textDecoration: "none", color: "inherit",
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inq.subject}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inq.company?.name ?? inq.fromCompany ?? "Unknown"}
                          {inq.origin && inq.destination ? ` · ${inq.origin} → ${inq.destination}` : ""}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)" }}>{RFQ_NEXT[col.stage]} →</div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Two-column: Operations | Procurement */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Operations: shipments + milestones + docs */}
        <div>
          {overdueJobs.length > 0 && (
            <SectionCard title="Past ETA" count={overdueJobs.length}>
              {overdueJobs.map((job) => (
                <a key={job.id} href={`/dashboard/jobs/${job.id}`} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "11px 18px", borderBottom: "1px solid var(--border)", borderLeft: "3px solid var(--danger)",
                  textDecoration: "none", color: "inherit",
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 2, fontFamily: "ui-monospace, Menlo, monospace" }}>{job.reference}</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {job.company?.name ?? "—"} · {job.origin && job.destination ? `${job.origin} → ${job.destination}` : "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)" }}>ETA {fmtDate(job.eta!)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{relDays(job.eta!)}</div>
                  </div>
                </a>
              ))}
            </SectionCard>
          )}

          <SectionCard title="Upcoming Milestones (7 days)" count={upcomingMilestones.length}>
            {upcomingMilestones.length === 0 ? (
              <div style={{ padding: "20px", fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>
                No milestones in the next 7 days.
              </div>
            ) : (
              upcomingMilestones.map((m) => {
                const isClose = m.plannedAt && new Date(m.plannedAt) <= in3;
                return (
                  <a key={m.id} href={`/dashboard/jobs/${m.job.id}?tab=milestones`} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 18px", borderBottom: "1px solid var(--border)",
                    textDecoration: "none", color: "inherit",
                  }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", fontFamily: "ui-monospace, Menlo, monospace" }}>{m.job.reference}</span>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{MILESTONE_LABEL[m.type] ?? m.type}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{m.job.company?.name ?? "—"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: isClose ? "var(--text)" : "var(--text-2)" }}>
                        {fmtDate(m.plannedAt!)}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{relDays(m.plannedAt!)}</div>
                    </div>
                  </a>
                );
              })
            )}
          </SectionCard>

          {pendingDocs.length > 0 && (
            <SectionCard title="Pending Documents" count={pendingDocs.length}>
              {pendingDocs.map((d) => (
                <a key={d.id} href={`/dashboard/jobs/${d.job.id}?tab=documents`} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 18px", borderBottom: "1px solid var(--border)",
                  textDecoration: "none", color: "inherit",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon name="file" size={14} style={{ color: "var(--text-3)" }} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 2, fontFamily: "ui-monospace, Menlo, monospace" }}>{d.job.reference}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{d.name}</div>
                    </div>
                  </div>
                  <StatusPill s={d.job.status} />
                </a>
              ))}
            </SectionCard>
          )}
        </div>

        {/* Procurement column */}
        <div>
          {jobsMissingRates.length > 0 && (
            <SectionCard
              title="Jobs Awaiting Carrier Rates"
              count={jobsMissingRates.length}
              action={<span style={{ fontSize: 11, color: "var(--text-3)" }}>No cost set yet</span>}
            >
              {jobsMissingRates.map((job) => (
                <a key={job.id} href={`/dashboard/jobs/${job.id}?tab=procurement`} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 18px", borderBottom: "1px solid var(--border)",
                  textDecoration: "none", color: "inherit",
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 2, fontFamily: "ui-monospace, Menlo, monospace" }}>{job.reference}</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {job.company?.name ?? "—"} · {job.origin && job.destination ? `${job.origin} → ${job.destination}` : "Route TBD"}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, marginLeft: 10, fontSize: 11, fontWeight: 600, color: "var(--brand)", whiteSpace: "nowrap" }}>
                    Source rates →
                  </span>
                </a>
              ))}
            </SectionCard>
          )}

          <SectionCard title="Quick Actions">
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { href: "/dashboard/rfq/new",        label: "Manual RFQ entry",       sub: "Add a request received off-channel", icon: "inbox" as const },
                { href: "/dashboard/jobs/new",       label: "New Job",                sub: "Create a shipment job manually",     icon: "truck" as const },
                { href: "/dashboard/settings/email", label: "Connect inbox",          sub: "Auto-capture inbound RFQs",           icon: "mail" as const },
                { href: "/dashboard/pricing",        label: "Manage lane rates",      sub: "Update standard buy/sell rates",      icon: "tag" as const },
              ].map((a) => (
                <a key={a.href} href={a.href} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 11px",
                  borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)",
                  textDecoration: "none", color: "inherit",
                }}>
                  <Icon name={a.icon} size={15} style={{ color: "var(--text-2)" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{a.sub}</div>
                  </div>
                  <Icon name="chevron-right" size={14} style={{ color: "var(--text-3)" }} />
                </a>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
