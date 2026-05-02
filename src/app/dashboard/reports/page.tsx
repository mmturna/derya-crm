import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import Link from "next/link";

type SearchParams = Promise<{ period?: string }>;

const PERIOD_OPTIONS = [
  { value: "7",  label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const JOB_STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"] as const;
const JOB_STATUS_META: Record<string, { label: string; color: string }> = {
  INQUIRY:    { label: "Inquiry",    color: "#1e3a8a" },
  QUOTED:     { label: "Quoted",     color: "#f59e0b" },
  BOOKED:     { label: "Booked",     color: "#3b82f6" },
  IN_TRANSIT: { label: "In Transit", color: "#8b5cf6" },
  CUSTOMS:    { label: "Customs",    color: "#f97316" },
  DELIVERED:  { label: "Delivered",  color: "#10b981" },
};

const MODE_LABEL: Record<string, string> = {
  "SEA-FCL": "Sea FCL", "SEA-LCL": "Sea LCL", AIR: "Air", ROAD: "Road", COURIER: "Courier",
};
const MODE_COLOR: Record<string, string> = {
  "SEA-FCL": "#3b82f6", "SEA-LCL": "#06b6d4", AIR: "#8b5cf6", ROAD: "#f59e0b", COURIER: "#ec4899",
};

function Kpi({ label, value, sub, color = "var(--text)" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const { period = "30" } = await searchParams;
  const days = parseInt(period, 10) || 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [
    jobsAll,
    jobsRecent,
    inquiriesRecent,
    deliveredJobs,
    carrierQuotes,
  ] = await Promise.all([
    prisma.job.findMany({
      where: { officeId: session.officeId },
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.job.findMany({
      where: { officeId: session.officeId, createdAt: { gte: since } },
    }),
    prisma.inquiry.findMany({
      where: { officeId: session.officeId, receivedAt: { gte: since } },
      select: { id: true, status: true, mode: true, receivedAt: true },
    }),
    prisma.job.findMany({
      where: { officeId: session.officeId, status: "DELIVERED", updatedAt: { gte: since } },
      include: { milestones: { where: { type: "ETA" } } },
    }),
    prisma.carrierQuote.findMany({
      where: { inquiry: { officeId: session.officeId, receivedAt: { gte: since } } },
      include: { inquiry: { select: { mode: true } } },
    }),
  ]);

  // ── Pipeline (all-time, by status) ──────────────────────────────────────
  const pipeByStatus = JOB_STATUS_ORDER.map((s) => {
    const list = jobsAll.filter((j) => j.status === s);
    const value = list.reduce((sum, j) => sum + (j.revenue ?? 0), 0);
    return { status: s, count: list.length, value };
  });
  const pipeTotal = pipeByStatus.reduce((s, x) => s + x.count, 0);

  // ── Active jobs (in-flight value) ───────────────────────────────────────
  const activeJobs = jobsAll.filter((j) => !["DELIVERED", "CANCELLED"].includes(j.status));
  const inTransitValue = jobsAll
    .filter((j) => ["BOOKED", "IN_TRANSIT", "CUSTOMS"].includes(j.status))
    .reduce((s, j) => s + (j.revenue ?? 0), 0);

  // ── RFQ Funnel (period) ─────────────────────────────────────────────────
  const rfqByStatus = {
    received:  inquiriesRecent.length,
    parsed:    inquiriesRecent.filter((i) => ["PARSED", "PRICED", "QUOTED", "WON", "LOST"].includes(i.status)).length,
    priced:    inquiriesRecent.filter((i) => ["PRICED", "QUOTED", "WON", "LOST"].includes(i.status)).length,
    quoted:    inquiriesRecent.filter((i) => ["QUOTED", "WON", "LOST"].includes(i.status)).length,
    won:       inquiriesRecent.filter((i) => i.status === "WON").length,
  };
  const rfqWinRate = (rfqByStatus.won + rfqByStatus.quoted) > 0
    ? Math.round((rfqByStatus.won / Math.max(rfqByStatus.won + rfqByStatus.quoted, 1)) * 100)
    : 0;

  // ── Revenue / Margin (period) ───────────────────────────────────────────
  const closedRev = jobsRecent.filter((j) => j.revenue).reduce((s, j) => s + (j.revenue ?? 0), 0);
  const closedCost = jobsRecent.filter((j) => j.cost).reduce((s, j) => s + (j.cost ?? 0), 0);
  const grossMargin = closedRev - closedCost;
  const marginPct = closedRev > 0 ? (grossMargin / closedRev) * 100 : 0;

  // ── On-time delivery (period, delivered jobs) ───────────────────────────
  let onTime = 0, late = 0;
  for (const j of deliveredJobs) {
    const eta = j.milestones[0]?.plannedAt;
    const actual = j.milestones[0]?.actualAt ?? j.updatedAt;
    if (!eta) continue;
    if (new Date(actual) <= new Date(eta)) onTime++; else late++;
  }
  const otdPct = onTime + late > 0 ? Math.round((onTime / (onTime + late)) * 100) : null;

  // ── Mode breakdown ──────────────────────────────────────────────────────
  const modeAgg: Record<string, { count: number; revenue: number }> = {};
  for (const j of jobsAll) {
    const m = j.mode ?? "OTHER";
    if (!modeAgg[m]) modeAgg[m] = { count: 0, revenue: 0 };
    modeAgg[m].count++;
    modeAgg[m].revenue += j.revenue ?? 0;
  }
  const modeRows = Object.entries(modeAgg).sort((a, b) => b[1].revenue - a[1].revenue);
  const modeTotalRev = modeRows.reduce((s, [, v]) => s + v.revenue, 0);

  // ── Top customers by revenue ────────────────────────────────────────────
  const customerAgg = new Map<string, { name: string; jobs: number; revenue: number }>();
  for (const j of jobsAll) {
    if (!j.companyId) continue;
    const cur = customerAgg.get(j.companyId) ?? { name: j.company?.name ?? "—", jobs: 0, revenue: 0 };
    cur.jobs++;
    cur.revenue += j.revenue ?? 0;
    customerAgg.set(j.companyId, cur);
  }
  const topCustomers = [...customerAgg.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6);
  const topCustomerMax = topCustomers[0]?.[1].revenue ?? 1;

  // ── Lane performance ────────────────────────────────────────────────────
  const laneAgg = new Map<string, { jobs: number; revenue: number; cost: number }>();
  for (const j of jobsAll) {
    if (!j.origin || !j.destination) continue;
    const key = `${j.origin} → ${j.destination}`;
    const cur = laneAgg.get(key) ?? { jobs: 0, revenue: 0, cost: 0 };
    cur.jobs++;
    cur.revenue += j.revenue ?? 0;
    cur.cost += j.cost ?? 0;
    laneAgg.set(key, cur);
  }
  const topLanes = [...laneAgg.entries()]
    .filter(([, v]) => v.revenue > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);

  // ── Carrier performance ─────────────────────────────────────────────────
  const carrierAgg = new Map<string, { quotes: number; avgTransit: number; transitN: number }>();
  for (const cq of carrierQuotes) {
    const cur = carrierAgg.get(cq.carrier) ?? { quotes: 0, avgTransit: 0, transitN: 0 };
    cur.quotes++;
    if (cq.transitDays) {
      cur.avgTransit = (cur.avgTransit * cur.transitN + cq.transitDays) / (cur.transitN + 1);
      cur.transitN++;
    }
    carrierAgg.set(cq.carrier, cur);
  }
  const topCarriers = [...carrierAgg.entries()].sort((a, b) => b[1].quotes - a[1].quotes).slice(0, 5);

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Forwarding & Procurement Reports</h1>
          <p className="page-subtitle">Operations metrics, RFQ funnel, margin, and supplier performance</p>
        </div>
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

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 20 }}>
        <Kpi label="Active Jobs" value={activeJobs.length} sub={`of ${jobsAll.length} total`} />
        <Kpi label="In-Flight Value" value={`$${(inTransitValue / 1000).toFixed(1)}k`} color="#8b5cf6" sub="Booked → Customs" />
        <Kpi label="RFQs Received" value={rfqByStatus.received} sub={`last ${days}d`} color="#1e3a8a" />
        <Kpi label="Win Rate" value={`${rfqWinRate}%`} sub={`${rfqByStatus.won} won`} color={rfqWinRate >= 50 ? "#10b981" : rfqWinRate >= 30 ? "#f59e0b" : "#ef4444"} />
        <Kpi label="Gross Margin" value={`${marginPct.toFixed(1)}%`} sub={`$${grossMargin.toLocaleString()}`} color={marginPct >= 20 ? "#10b981" : marginPct >= 10 ? "#f59e0b" : "#ef4444"} />
        <Kpi label="On-Time Delivery" value={otdPct != null ? `${otdPct}%` : "—"} sub={`${onTime}/${onTime + late} delivered`} color={otdPct != null && otdPct >= 90 ? "#10b981" : "#f59e0b"} />
      </div>

      {/* Pipeline + RFQ Funnel */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="section-title">Job Pipeline</span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{pipeTotal} total · ${(pipeByStatus.reduce((s, p) => s + p.value, 0) / 1000).toFixed(1)}k value</span>
          </header>
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {pipeByStatus.map((p) => {
              const meta = JOB_STATUS_META[p.status];
              return (
                <div key={p.status}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{meta.label}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                      <strong style={{ color: "var(--text)" }}>{p.count}</strong>
                      {p.value > 0 && <span style={{ marginLeft: 8 }}>${(p.value / 1000).toFixed(1)}k</span>}
                    </span>
                  </div>
                  <Bar value={p.count} total={pipeTotal} color={meta.color} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <span className="section-title">RFQ Funnel ({days}d)</span>
          </header>
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Received", count: rfqByStatus.received, color: "#1e3a8a" },
              { label: "Parsed",   count: rfqByStatus.parsed,   color: "#8b5cf6" },
              { label: "Priced",   count: rfqByStatus.priced,   color: "#f59e0b" },
              { label: "Quoted",   count: rfqByStatus.quoted,   color: "#3b82f6" },
              { label: "Won",      count: rfqByStatus.won,      color: "#10b981" },
            ].map((step, i, all) => {
              const drop = i === 0 ? 0 : Math.max(all[i - 1].count - step.count, 0);
              return (
                <div key={step.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{step.label}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                      <strong style={{ color: "var(--text)" }}>{step.count}</strong>
                      {drop > 0 && <span style={{ marginLeft: 8, color: "#ef4444" }}>−{drop}</span>}
                    </span>
                  </div>
                  <Bar value={step.count} total={rfqByStatus.received || 1} color={step.color} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mode + Top Customers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <span className="section-title">Mode Mix</span>
          </header>
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {modeRows.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>No jobs yet.</div>
            ) : modeRows.map(([m, v]) => (
              <div key={m}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{MODE_LABEL[m] ?? m}</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                    <strong style={{ color: "var(--text)" }}>{v.count}</strong>
                    <span style={{ marginLeft: 8 }}>${(v.revenue / 1000).toFixed(1)}k</span>
                  </span>
                </div>
                <Bar value={v.revenue} total={modeTotalRev || 1} color={MODE_COLOR[m] ?? "#6b7280"} />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <span className="section-title">Top Customers (revenue)</span>
          </header>
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {topCustomers.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>No revenue yet.</div>
            ) : topCustomers.map(([id, v]) => (
              <Link key={id} href={`/dashboard/customers/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{v.name}</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                    <strong style={{ color: "var(--text)" }}>${(v.revenue / 1000).toFixed(1)}k</strong>
                    <span style={{ marginLeft: 8 }}>{v.jobs} jobs</span>
                  </span>
                </div>
                <Bar value={v.revenue} total={topCustomerMax} color="#1e3a8a" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Top Lanes + Carrier Performance */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <span className="section-title">Top Lanes (margin)</span>
          </header>
          <div>
            {topLanes.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: "var(--text-3)" }}>No lane data yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th style={{ textAlign: "right" }}>Jobs</th>
                    <th style={{ textAlign: "right" }}>Revenue</th>
                    <th style={{ textAlign: "right" }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {topLanes.map(([lane, v]) => {
                    const m = v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0;
                    return (
                      <tr key={lane}>
                        <td style={{ fontWeight: 600 }}>{lane}</td>
                        <td style={{ textAlign: "right" }}>{v.jobs}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>${(v.revenue / 1000).toFixed(1)}k</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: m >= 20 ? "#10b981" : m >= 10 ? "#f59e0b" : "#ef4444" }}>
                          {m.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <span className="section-title">Carrier Performance ({days}d)</span>
          </header>
          <div>
            {topCarriers.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: "var(--text-3)" }}>No carrier quotes yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Carrier</th>
                    <th style={{ textAlign: "right" }}>Quotes</th>
                    <th style={{ textAlign: "right" }}>Avg Transit</th>
                  </tr>
                </thead>
                <tbody>
                  {topCarriers.map(([carrier, v]) => (
                    <tr key={carrier}>
                      <td style={{ fontWeight: 600 }}>{carrier}</td>
                      <td style={{ textAlign: "right" }}>{v.quotes}</td>
                      <td style={{ textAlign: "right", color: "var(--text-3)" }}>
                        {v.transitN > 0 ? `${v.avgTransit.toFixed(0)}d` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
