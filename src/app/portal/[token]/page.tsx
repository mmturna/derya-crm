import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

const STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"] as const;
const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "Inquiry", QUOTED: "Quoted", BOOKED: "Booked",
  IN_TRANSIT: "In Transit", CUSTOMS: "Customs", DELIVERED: "Delivered",
};
const MILESTONE_LABEL: Record<string, string> = {
  BOOKING: "Booking", CARGO_READY: "Cargo Ready", ETD: "ETD",
  ETA: "ETA", CUSTOMS_ENTRY: "Customs Entry", CUSTOMS_RELEASE: "Customs Release", DELIVERY: "Delivery",
};
const MODE_LABEL: Record<string, string> = {
  "SEA-FCL": "Sea FCL", "SEA-LCL": "Sea LCL", AIR: "Air", ROAD: "Road", COURIER: "Courier",
};

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Token = job.id for MVP. CUIDs are unguessable enough for demo.
  // TODO: replace with HMAC-signed token before production.
  const job = await prisma.job.findUnique({
    where: { id: token },
    include: {
      company: { select: { name: true } },
      milestones: { orderBy: { createdAt: "asc" } },
      documents: { where: { status: "APPROVED" }, orderBy: { createdAt: "asc" } },
      office: { select: { name: true } },
    },
  });

  if (!job) notFound();

  const currentIdx = (STATUS_ORDER as readonly string[]).indexOf(job.status);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = job.eta && new Date(job.eta) < today && job.status !== "DELIVERED";
  const totalMs = job.milestones.length;
  const doneMs = job.milestones.filter((m) => m.actualAt).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <header style={{ padding: "20px 24px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "#111827", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>D</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{job.office?.name ?? "Derya"}</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Shipment portal</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>Read-only · auto-updating</div>
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px" }}>

        {/* Headline */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b7280", marginBottom: 6, fontFamily: "ui-monospace, Menlo, monospace" }}>
            {job.reference}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111827", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            {job.company?.name ?? "Your shipment"}
          </h1>
          <div style={{ fontSize: 15, color: "#4b5563" }}>
            {job.origin && job.destination ? `${job.origin} → ${job.destination}` : "Route TBD"}
            {job.mode ? ` · ${MODE_LABEL[job.mode] ?? job.mode}` : ""}
            {job.commodity ? ` · ${job.commodity}` : ""}
          </div>
        </div>

        {/* Status pipeline (read-only) */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 14 }}>
            Current status
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${STATUS_ORDER.length}, 1fr)`, gap: 0, marginBottom: 0 }}>
            {STATUS_ORDER.map((s, i) => (
              <div key={s} style={{ position: "relative", textAlign: "center" }}>
                <div style={{
                  position: "absolute", top: 11, left: "50%", right: i === STATUS_ORDER.length - 1 ? "50%" : "-50%",
                  height: 2, background: i < currentIdx ? "#1e3a8a" : "#e5e7eb", zIndex: 0,
                }} />
                <div style={{
                  position: "relative", zIndex: 1,
                  width: 24, height: 24, borderRadius: "50%",
                  background: i <= currentIdx ? "#1e3a8a" : "#fff",
                  border: `2px solid ${i <= currentIdx ? "#1e3a8a" : "#d1d5db"}`,
                  margin: "0 auto 8px",
                }} />
                <div style={{
                  fontSize: 11.5, fontWeight: i === currentIdx ? 700 : 500,
                  color: i <= currentIdx ? "#111827" : "#9ca3af",
                }}>
                  {STATUS_LABEL[s]}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Headline ETA card */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "ETD", value: fmt(job.etd), color: "#111827" },
            { label: "ETA", value: fmt(job.eta), color: isOverdue ? "#dc2626" : "#111827" },
            { label: "Progress", value: `${doneMs} / ${totalMs}`, color: "#111827" },
          ].map((m) => (
            <div key={m.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b7280", marginBottom: 6 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: m.color, lineHeight: 1.1 }}>{m.value}</div>
            </div>
          ))}
        </div>

        {isOverdue && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>
            Heads up — ETA was {fmt(job.eta)}. Your forwarder is on it; reach out if you need an update.
          </div>
        )}

        {/* Milestones detail */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4b5563" }}>
              Shipment milestones
            </div>
          </div>
          <div>
            {job.milestones.map((m, i) => {
              const isDone = !!m.actualAt;
              const isLate = m.plannedAt && !isDone && new Date(m.plannedAt) < today;
              return (
                <div key={m.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 20px",
                  borderBottom: i === job.milestones.length - 1 ? "none" : "1px solid #f3f4f6",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: isDone ? "#1e3a8a" : "#f3f4f6",
                      border: `1.5px solid ${isDone ? "#1e3a8a" : isLate ? "#dc2626" : "#d1d5db"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isDone && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: isDone ? 600 : 500, color: isDone ? "#111827" : "#4b5563" }}>
                      {MILESTONE_LABEL[m.type] ?? m.type}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: isLate ? "#dc2626" : "#6b7280", fontFamily: "ui-monospace, Menlo, monospace" }}>
                    {isDone ? `Done ${fmt(m.actualAt)}` : m.plannedAt ? `Planned ${fmt(m.plannedAt)}` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Approved documents (download placeholder) */}
        {job.documents.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4b5563" }}>
                Approved documents
              </div>
            </div>
            <div>
              {job.documents.map((d, i) => (
                <div key={d.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "11px 20px",
                  borderBottom: i === job.documents.length - 1 ? "none" : "1px solid #f3f4f6",
                  fontSize: 13,
                }}>
                  <span style={{ fontWeight: 500 }}>{d.name}</span>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>{fmt(d.updatedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, padding: 20, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>
          Questions? Reply to your forwarder's last email — they'll see it in their workbench.
          <br />
          This page is read-only and updates automatically as your shipment moves.
        </div>
      </main>
    </div>
  );
}
