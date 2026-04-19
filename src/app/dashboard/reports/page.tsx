import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import Link from "next/link";

type SearchParams = Promise<{ period?: string }>;

const PERIOD_OPTIONS = [
  { value: "7",  label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const STATUS_ORDER = ["UNTOUCHED", "IN_PROGRESS", "WORKED", "LOST"];
const STATUS_LABELS: Record<string, string> = {
  UNTOUCHED: "New",
  IN_PROGRESS: "Talking",
  WORKED: "Active",
  LOST: "Lost",
};
const STATUS_COLORS: Record<string, string> = {
  UNTOUCHED: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
  WORKED: "#10b981",
  LOST: "#ef4444",
};

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const { period = "30" } = await searchParams;
  const days = parseInt(period, 10) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    users,
    quoteByResult,
    statusBreakdown,
    recentActivities,
    pendingQuotes,
    openTasks,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { officeId: session.officeId, isActive: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.quote.groupBy({
      by: ["result"],
      where: { officeId: session.officeId },
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.company.groupBy({
      by: ["status"],
      where: { officeId: session.officeId },
      _count: { _all: true },
    }),
    prisma.activity.findMany({
      where: { officeId: session.officeId, occurredAt: { gte: since } },
      select: { createdByUserId: true },
    }),
    prisma.quote.count({
      where: { officeId: session.officeId, result: "PENDING" },
    }),
    prisma.task.count({
      where: { officeId: session.officeId, status: "OPEN" },
    }),
  ]);

  // Per-rep stats
  const repStats = users
    .map((user) => ({
      user,
      actCount: recentActivities.filter((a) => a.createdByUserId === user.id).length,
    }))
    .filter((r) => r.actCount > 0)
    .sort((a, b) => b.actCount - a.actCount);

  const maxActCount = Math.max(...repStats.map((r) => r.actCount), 1);

  // Quote totals
  const wonData = quoteByResult.find((q) => q.result === "WON");
  const lostData = quoteByResult.find((q) => q.result === "LOST");
  const resolvedQuotes = (wonData?._count._all ?? 0) + (lostData?._count._all ?? 0);
  const winRate = resolvedQuotes > 0
    ? Math.round(((wonData?._count._all ?? 0) / resolvedQuotes) * 100)
    : null;
  const totalWonValue = wonData?._sum.value ?? 0;
  const totalCompanies = statusBreakdown.reduce((s, i) => s + i._count._all, 0);
  const totalActivities = recentActivities.length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>Reports</h1>
        <div style={{ display: "flex", gap: 2, background: "var(--surface-3)", borderRadius: 8, padding: 3 }}>
          {PERIOD_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={`?period=${opt.value}`}
              style={{
                display: "inline-block",
                padding: "5px 14px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                background: period === opt.value ? "var(--surface)" : "transparent",
                color: period === opt.value ? "var(--text)" : "var(--text-3)",
                boxShadow: period === opt.value ? "var(--shadow-xs)" : "none",
                textDecoration: "none",
              }}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {/* KPI row — full width */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Activities", value: totalActivities, color: "var(--brand)" },
          { label: "Open tasks", value: openTasks, color: openTasks > 0 ? "var(--warning)" : "var(--text-3)" },
          { label: "Pending quotes", value: pendingQuotes, color: pendingQuotes > 0 ? "var(--warning)" : "var(--text-3)" },
          { label: "Win rate", value: winRate !== null ? `${winRate}%` : "—", color: winRate !== null && winRate >= 50 ? "var(--success)" : "var(--danger)" },
          { label: "Won value", value: totalWonValue ? `$${totalWonValue.toLocaleString()}` : "—", color: "var(--success)" },
        ].map((kpi) => (
          <div key={kpi.label} style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "14px 16px",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              {kpi.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: kpi.color }}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* 2-column: team + pipeline */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Team leaderboard */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Team activity</span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>last {days} days</span>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
            {repStats.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No activity recorded yet.</p>
            ) : repStats.map(({ user, actCount }) => (
              <div key={user.id}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{user.fullName}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand)" }}>{actCount}</span>
                </div>
                <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.round((actCount / maxActCount) * 100)}%`,
                    background: "var(--brand)",
                    borderRadius: 3,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline funnel */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Pipeline</span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{totalCompanies} accounts total</span>
          </div>
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
            {STATUS_ORDER.map((status) => {
              const count = statusBreakdown.find((s) => s.status === status)?._count._all ?? 0;
              const pct = totalCompanies > 0 ? Math.round((count / totalCompanies) * 100) : 0;
              return (
                <div key={status}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{STATUS_LABELS[status]}</span>
                    <span style={{ color: "var(--text-3)" }}>{count} <span style={{ fontSize: 11 }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: STATUS_COLORS[status], borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}

            {/* Won/Lost quick summary */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--success)" }}>{wonData?._count._all ?? 0}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Won</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--danger)" }}>{lostData?._count._all ?? 0}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Lost</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
