import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { PricingCalculator } from "@/components/pricing-calculator";
import { AutoSubmitSelect } from "@/components/auto-submit-select";

type SearchParams = Promise<{
  tab?: string;
  inquiry?: string;
  origin?: string; destination?: string; mode?: string; tier?: string; urgency?: string;
}>;

const MAJOR_CARRIERS = new Set(["MAERSK", "COSCO", "COSCO SHIPPING LINE", "CMA CGM", "HAPAG LLOYD", "HAPAG-LLOYD", "ONE", "EVERGREEN", "OOCL", "MSC"]);

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const canManage = session.role === "ADMIN" || session.role === "MANAGER";
  const sp = await searchParams;
  const tab = sp.tab ?? "inquiries";

  const [laneRates, marginProfiles, companies, inquiries] = await Promise.all([
    prisma.laneRate.findMany({ where: { officeId: session.officeId }, orderBy: [{ origin: "asc" }, { destination: "asc" }, { mode: "asc" }] }),
    prisma.marginProfile.findMany({ where: { officeId: session.officeId }, orderBy: { marginPercent: "asc" } }),
    prisma.company.findMany({ where: { officeId: session.officeId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.inquiry.findMany({
      where: { officeId: session.officeId },
      include: { carrierQuotes: { orderBy: { createdAt: "asc" } } },
      orderBy: { receivedAt: "desc" },
    }),
  ]);

  const selectedInquiry = sp.inquiry ? inquiries.find((i) => i.id === sp.inquiry) ?? null : inquiries[0] ?? null;

  // ── Calculator logic ──────────────────────────────────────────────────────
  let calcResult: {
    matchedLane: typeof laneRates[0] | null;
    margin: typeof marginProfiles[0] | null;
    baseAmount: number; marginAmount: number; recommendedAmount: number; floorAmount: number;
    currency: string; warnings: string[];
  } | null = null;

  if (sp.origin && sp.destination && sp.mode) {
    const origin = sp.origin.trim();
    const destination = sp.destination.trim();
    const mode = sp.mode;
    const tier = sp.tier || null;
    const urgency = sp.urgency || null;
    const matchedLane = laneRates.find((r) => r.origin.toLowerCase() === origin.toLowerCase() && r.destination.toLowerCase() === destination.toLowerCase() && r.mode === mode)
      ?? laneRates.find((r) => r.origin.toLowerCase().includes(origin.toLowerCase()) && r.destination.toLowerCase().includes(destination.toLowerCase()) && r.mode === mode)
      ?? null;
    const margin = marginProfiles.find((m) => m.customerTier === tier && m.urgency === urgency)
      ?? marginProfiles.find((m) => m.customerTier === tier && m.urgency === null)
      ?? marginProfiles.find((m) => m.customerTier === null && m.urgency === urgency)
      ?? marginProfiles.find((m) => m.customerTier === null && m.urgency === null)
      ?? marginProfiles[0] ?? null;
    const baseAmount = matchedLane?.baseAmount ?? 0;
    const marginPct = margin?.marginPercent ?? 18;
    const marginAmount = baseAmount * (marginPct / 100);
    const warnings: string[] = [];
    if (!matchedLane) warnings.push("No lane rate found — using fallback pricing.");
    if (!margin) warnings.push("No margin profile matched — using default margin.");
    calcResult = { matchedLane, margin, baseAmount, marginAmount, recommendedAmount: baseAmount + marginAmount, floorAmount: baseAmount * 1.05, currency: matchedLane?.currency ?? "USD", warnings };
  }

  // ── Server actions ────────────────────────────────────────────────────────

  async function addInquiryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const subject = String(formData.get("subject") ?? "").trim();
    const fromEmail = String(formData.get("fromEmail") ?? "").trim() || null;
    const fromCompany = String(formData.get("fromCompany") ?? "").trim() || null;
    const rawEmailBody = String(formData.get("rawEmailBody") ?? "").trim() || null;
    if (!subject) return;

    // Parse route from raw email body
    let origin: string | null = null;
    let destination: string | null = null;
    let containerType: string | null = null;

    if (rawEmailBody) {
      const routeMatch = rawEmailBody.match(/(?:from\s+)?([A-Za-z\s]+?)\s*(?:to|→|-+>)\s*([A-Za-z\s]+?)(?:\s|,|\.|$)/i);
      if (routeMatch) { origin = routeMatch[1].trim(); destination = routeMatch[2].trim(); }
      const containerMatch = rawEmailBody.match(/\b(20GP|20DRY|40GP|40DRY|40HC|40HQ|45HC|20RF|40RF)\b/i);
      if (containerMatch) containerType = containerMatch[1].toUpperCase();
    }

    const overrideOrigin = String(formData.get("origin") ?? "").trim() || null;
    const overrideDestination = String(formData.get("destination") ?? "").trim() || null;
    const overrideContainer = String(formData.get("containerType") ?? "").trim() || null;

    await prisma.inquiry.create({
      data: {
        officeId: s.officeId, subject,
        fromEmail, fromCompany,
        origin: overrideOrigin ?? origin,
        destination: overrideDestination ?? destination,
        containerType: overrideContainer ?? containerType,
        rawEmailBody, status: "INGESTED",
      }
    });
    revalidatePath("/dashboard/pricing");
  }

  async function deleteInquiryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    await prisma.inquiry.delete({ where: { id, officeId: s.officeId } });
    revalidatePath("/dashboard/pricing");
  }

  async function addCarrierQuoteAction(formData: FormData) {
    "use server";
    await requireSession();
    const inquiryId = String(formData.get("inquiryId") ?? "");
    const carrier = String(formData.get("carrier") ?? "").trim();
    const quoteType = String(formData.get("quoteType") ?? "EMAIL");
    const rateName = String(formData.get("rateName") ?? "").trim() || null;
    const total20 = Number(formData.get("total20") || 0) || null;
    const total40 = Number(formData.get("total40") || 0) || null;
    const total40HC = Number(formData.get("total40HC") || 0) || null;
    const transitDays = Number(formData.get("transitDays") || 0) || null;
    const service = String(formData.get("service") ?? "").trim() || null;
    const validity = String(formData.get("validity") ?? "").trim() || null;
    const transshipments = String(formData.get("transshipments") ?? "").trim() || null;
    const status = total20 || total40 || total40HC ? "RECEIVED" : "PENDING";
    if (!inquiryId || !carrier) return;
    await prisma.carrierQuote.create({ data: { inquiryId, carrier, quoteType, rateName, total20, total40, total40HC, transitDays, service, validity, transshipments, status } });
    revalidatePath("/dashboard/pricing");
  }

  async function deleteCarrierQuoteAction(formData: FormData) {
    "use server";
    await requireSession();
    const id = String(formData.get("id") ?? "");
    await prisma.carrierQuote.delete({ where: { id } });
    revalidatePath("/dashboard/pricing");
  }

  async function updateInquiryStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!id || !status) return;
    await prisma.inquiry.update({ where: { id, officeId: s.officeId }, data: { status } });
    revalidatePath("/dashboard/pricing");
  }

  async function addLaneRateAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== "ADMIN" && s.role !== "MANAGER") return;
    const origin = String(formData.get("origin") ?? "").trim();
    const destination = String(formData.get("destination") ?? "").trim();
    const mode = String(formData.get("mode") ?? "").trim();
    const baseAmount = Number(formData.get("baseAmount") ?? 0);
    const currency = String(formData.get("currency") ?? "USD").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!origin || !destination || !mode || !baseAmount) return;
    await prisma.laneRate.create({ data: { officeId: s.officeId, origin, destination, mode, baseAmount, currency, notes } });
    revalidatePath("/dashboard/pricing");
  }

  async function deleteLaneRateAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== "ADMIN" && s.role !== "MANAGER") return;
    const id = String(formData.get("id") ?? "");
    await prisma.laneRate.delete({ where: { id } });
    revalidatePath("/dashboard/pricing");
  }

  async function addMarginProfileAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== "ADMIN" && s.role !== "MANAGER") return;
    const label = String(formData.get("label") ?? "").trim();
    const customerTier = String(formData.get("customerTier") ?? "").trim() || null;
    const urgency = String(formData.get("urgency") ?? "").trim() || null;
    const marginPercent = Number(formData.get("marginPercent") ?? 0);
    if (!label || !marginPercent) return;
    await prisma.marginProfile.create({ data: { officeId: s.officeId, label, customerTier, urgency, marginPercent } });
    revalidatePath("/dashboard/pricing");
  }

  async function deleteMarginProfileAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== "ADMIN" && s.role !== "MANAGER") return;
    const id = String(formData.get("id") ?? "");
    await prisma.marginProfile.delete({ where: { id } });
    revalidatePath("/dashboard/pricing");
  }

  async function createQuoteFromCalcAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const companyId = String(formData.get("companyId") ?? "").trim();
    const origin = String(formData.get("origin") ?? "").trim() || null;
    const destination = String(formData.get("destination") ?? "").trim() || null;
    const mode = String(formData.get("mode") ?? "").trim() || null;
    const value = Number(formData.get("value") ?? 0);
    const currency = String(formData.get("currency") ?? "USD").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!companyId || !value) return;
    await prisma.quote.create({ data: { officeId: s.officeId, companyId, origin, destination, mode, value, currency, notes, result: "PENDING" } });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard/pricing");
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const modes = ["SEA-FCL", "SEA-LCL", "AIR", "ROAD", "COURIER"];
  const origins = [...new Set(laneRates.map((r) => r.origin))].sort();
  const destinations = [...new Set(laneRates.map((r) => r.destination))].sort();

  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
    INGESTED:  { bg: "#eff6ff", color: "#3b82f6", label: "New" },
    PARSED:    { bg: "#f0fdf4", color: "#16a34a", label: "Parsed" },
    PRICED:    { bg: "#faf5ff", color: "#9333ea", label: "Priced" },
    SENT:      { bg: "#f0fdf4", color: "#16a34a", label: "Sent" },
    NEEDS_INFO:{ bg: "#fffbeb", color: "#d97706", label: "Needs Info" },
  };

  type CarrierQuoteRow = { id: string; carrier: string; quoteType: string; rateName: string | null; total20: number | null; total40: number | null; total40HC: number | null; transitDays: number | null; service: string | null; validity: string | null; transshipments: string | null; status: string };
  function renderCarrierTable(
    quotes: CarrierQuoteRow[],
    title: string,
    description: string,
    inquiryId: string,
    showMethod: boolean = false,
  ) {
    if (quotes.length === 0) return null;
    const received = quotes.filter((q) => q.status === "RECEIVED");
    const recommended = received.length > 0
      ? received.filter((q) => q.total40HC).reduce<typeof quotes[0] | null>((best, q) => (!best || (q.total40HC ?? 0) < (best.total40HC ?? Infinity)) ? q : best, null) ?? received[0]
      : null;

    const initials = (name: string) => {
      const w = name.trim().split(/\s+/);
      return w.length >= 2 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    };

    const pending = quotes.filter((q) => q.status === "PENDING").length;
    const receivedCount = quotes.filter((q) => q.status === "RECEIVED").length;

    return (
      <div style={{ marginBottom: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        {/* Table header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{description}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-3)" }}>Pending: {pending}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "#dbeafe", color: "#1d4ed8" }}>Received: {receivedCount}</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>
                <th style={thStyle}>Carrier</th>
                {showMethod && <th style={thStyle}>Method</th>}
                <th style={thStyle}>Rates</th>
                <th style={{ ...thStyle, textAlign: "right" }}>20DRY</th>
                <th style={{ ...thStyle, textAlign: "right" }}>40DRY</th>
                <th style={{ ...thStyle, textAlign: "right" }}>40HC</th>
                <th style={thStyle}>Validity</th>
                <th style={thStyle}>Service</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Transship</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Transit</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q, idx) => {
                const isRec = recommended?.id === q.id;
                const rowBg = isRec ? "#eff6ff" : idx % 2 === 0 ? "var(--surface)" : "var(--surface-3)";
                return (
                  <tr key={q.id} style={{ background: rowBg, borderBottom: "1px solid var(--border)", borderLeft: isRec ? "3px solid #3b82f6" : "3px solid transparent" }}>
                    <td style={{ padding: "12px 16px", minWidth: 180 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                          {initials(q.carrier)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>{q.carrier}</div>
                          {isRec && <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600, marginTop: 2 }}>● Recommended</div>}
                        </div>
                      </div>
                    </td>
                    {showMethod && (
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: q.quoteType === "API" ? "#dbeafe" : "#f3f4f6", color: q.quoteType === "API" ? "#1d4ed8" : "#6b7280", border: `1px solid ${q.quoteType === "API" ? "#bfdbfe" : "#e5e7eb"}` }}>
                          {q.quoteType}
                        </span>
                      </td>
                    )}
                    <td style={{ padding: "12px 14px", color: "var(--text-3)" }}>{q.rateName ?? "—"}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{q.total20 ? `$${q.total20.toLocaleString()}` : "—"}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{q.total40 ? `$${q.total40.toLocaleString()}` : "—"}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: isRec ? "#1d4ed8" : "var(--text)" }}>{q.total40HC ? `$${q.total40HC.toLocaleString()}` : "—"}</td>
                    <td style={{ padding: "12px 14px", color: "var(--text-3)", fontSize: 12 }}>{q.validity ?? "—"}</td>
                    <td style={{ padding: "12px 14px", color: "var(--text-3)", fontSize: 12 }}>{q.service ?? "—"}</td>
                    <td style={{ padding: "12px 14px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>{q.transshipments ?? "—"}</td>
                    <td style={{ padding: "12px 14px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>{q.transitDays ? `${q.transitDays}d` : "—"}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <form action={deleteCarrierQuoteAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={q.id} />
                        <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 16, padding: 0 }}>×</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Add carrier quote */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "var(--surface-3)" }}>
          <details>
            <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none" }}>+ Add carrier quote</summary>
            <form action={addCarrierQuoteAction} style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 8, alignItems: "end" }}>
              <input type="hidden" name="inquiryId" value={inquiryId} />
              <input type="hidden" name="quoteType" value={showMethod ? "EMAIL" : "API"} />
              <input name="carrier" required placeholder="Carrier name" style={inputStyle} />
              <input name="rateName" placeholder="Rate name" style={inputStyle} />
              <input name="total40HC" type="number" placeholder="40HC rate" style={inputStyle} />
              <input name="transitDays" type="number" placeholder="Transit days" style={inputStyle} />
              <input name="validity" placeholder="Validity" style={inputStyle} />
              <button type="submit" style={{ padding: "7px 14px", borderRadius: 6, background: "var(--brand)", color: "#fff", border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>Add</button>
            </form>
          </details>
        </div>
      </div>
    );
  }

  const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "var(--text-3)" };
  const inputStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, background: "var(--surface)", color: "var(--text)", width: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header + tabs */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 16px" }}>Pricing</h1>
        <div style={{ display: "flex", gap: 4, borderBottom: "2px solid var(--border)", paddingBottom: 0 }}>
          {[
            { key: "inquiries", label: "Inquiries", count: inquiries.length },
            { key: "calculator", label: "Rate Calculator" },
            { key: "settings", label: "Rate Settings" },
          ].map(({ key, label, count }) => {
            const active = tab === key;
            return (
              <a
                key={key}
                href={`/dashboard/pricing?tab=${key}`}
                style={{
                  padding: "8px 16px",
                  fontSize: 13, fontWeight: 600,
                  color: active ? "var(--brand)" : "var(--text-3)",
                  borderBottom: active ? "2px solid var(--brand)" : "2px solid transparent",
                  marginBottom: -2,
                  textDecoration: "none",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {label}
                {count !== undefined && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: active ? "var(--brand)" : "var(--surface-3)", color: active ? "#fff" : "var(--text-3)", border: active ? "none" : "1px solid var(--border)" }}>
                    {count}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* ── TAB: INQUIRIES ─────────────────────────────────────────────────── */}
      {tab === "inquiries" && (
        <div style={{ display: "flex", gap: 0, flex: 1, minHeight: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          {/* Left sidebar — inquiry list */}
          <div style={{ width: 300, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Inquiries</span>
              <details style={{ position: "relative" }}>
                <summary style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "3px 10px", border: "1px solid var(--brand)", borderRadius: 5 }}>+ New</summary>
                <div style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 30, width: 320, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>New inquiry</div>
                  <form action={addInquiryAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input name="subject" required placeholder="Subject / title" style={inputStyle} />
                    <input name="fromEmail" type="email" placeholder="Client email (optional)" style={inputStyle} />
                    <input name="fromCompany" placeholder="Client company (optional)" style={inputStyle} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input name="origin" placeholder="Origin" style={inputStyle} />
                      <input name="destination" placeholder="Destination" style={inputStyle} />
                    </div>
                    <select name="containerType" style={inputStyle}>
                      <option value="">Container type…</option>
                      {["20GP","20DRY","40GP","40DRY","40HC","40HQ","45HC"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <textarea name="rawEmailBody" placeholder="Paste email body (optional — route & container auto-extracted)" rows={4} style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace" }} />
                    <button type="submit" style={{ padding: "8px", borderRadius: 7, background: "var(--brand)", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Create inquiry</button>
                  </form>
                </div>
              </details>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {inquiries.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No inquiries yet. Create one to start tracking carrier quotes.</div>
              ) : (
                inquiries.map((inq) => {
                  const isSelected = selectedInquiry?.id === inq.id;
                  const sc = statusColors[inq.status] ?? statusColors.INGESTED;
                  const receivedCount = inq.carrierQuotes.filter((q) => q.status === "RECEIVED").length;
                  const totalCount = inq.carrierQuotes.length;
                  return (
                    <a
                      key={inq.id}
                      href={`/dashboard/pricing?tab=inquiries&inquiry=${inq.id}`}
                      style={{
                        display: "block", padding: "12px 16px", textDecoration: "none",
                        borderBottom: "1px solid var(--border)",
                        background: isSelected ? "#eff6ff" : "var(--surface)",
                        borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, flex: 1, marginRight: 8 }}>{inq.fromCompany ?? inq.fromEmail ?? "Unknown"}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: sc.bg, color: sc.color, whiteSpace: "nowrap" }}>{sc.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inq.subject}</div>
                      {(inq.origin || inq.destination) && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", marginBottom: 4 }}>
                          {inq.origin ?? "?"} → {inq.destination ?? "?"}
                          {inq.containerType && <span style={{ marginLeft: 6, color: "var(--text-3)", fontWeight: 400 }}>· {inq.containerType}</span>}
                        </div>
                      )}
                      {totalCount > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{receivedCount}/{totalCount} quotes received</div>
                      )}
                    </a>
                  );
                })
              )}
            </div>
          </div>

          {/* Main content — carrier tables */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {!selectedInquiry ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 13 }}>
                Select an inquiry or create a new one
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                {/* Inquiry header */}
                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{selectedInquiry.subject}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                      {selectedInquiry.fromEmail && <span>{selectedInquiry.fromEmail}</span>}
                      {selectedInquiry.origin && selectedInquiry.destination && (
                        <span style={{ marginLeft: 8, fontWeight: 600, color: "var(--text-2)" }}>{selectedInquiry.origin} → {selectedInquiry.destination}</span>
                      )}
                      {selectedInquiry.containerType && <span style={{ marginLeft: 8 }}>· {selectedInquiry.containerType}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <form action={updateInquiryStatusAction}>
                      <input type="hidden" name="id" value={selectedInquiry.id} />
                      <AutoSubmitSelect
                        name="status"
                        defaultValue={selectedInquiry.status}
                        style={{ ...inputStyle, fontSize: 11, fontWeight: 700, width: "auto" }}
                        options={["INGESTED","PARSED","PRICED","SENT","NEEDS_INFO"].map((s) => ({ value: s, label: statusColors[s]?.label ?? s }))}
                      />
                    </form>
                    <form action={deleteInquiryAction}>
                      <input type="hidden" name="id" value={selectedInquiry.id} />
                      <button type="submit" style={{ padding: "6px 12px", borderRadius: 6, background: "none", border: "1px solid var(--border)", color: "var(--text-3)", fontSize: 12, cursor: "pointer" }}>Delete</button>
                    </form>
                  </div>
                </div>

                {/* Raw email body if present */}
                {selectedInquiry.rawEmailBody && (
                  <details style={{ padding: "0 24px" }}>
                    <summary style={{ fontSize: 12, color: "var(--text-3)", cursor: "pointer", padding: "10px 0", listStyle: "none" }}>View original email ▾</summary>
                    <pre style={{ fontSize: 12, color: "var(--text-3)", background: "var(--surface-3)", padding: 12, borderRadius: 6, whiteSpace: "pre-wrap", fontFamily: "monospace", marginBottom: 12 }}>{selectedInquiry.rawEmailBody}</pre>
                  </details>
                )}

                {/* Carrier tables */}
                <div style={{ padding: "20px 24px", flex: 1 }}>
                  {renderCarrierTable(
                    selectedInquiry.carrierQuotes.filter((q) => MAJOR_CARRIERS.has(q.carrier.toUpperCase())),
                    "Major Carriers",
                    "Quotes from major carriers with direct API integration",
                    selectedInquiry.id,
                    false,
                  )}
                  {renderCarrierTable(
                    selectedInquiry.carrierQuotes.filter((q) => !MAJOR_CARRIERS.has(q.carrier.toUpperCase())),
                    "Regional & Local Carriers",
                    "Quotes from regional carriers via email request",
                    selectedInquiry.id,
                    true,
                  )}
                  {selectedInquiry.carrierQuotes.length === 0 && (
                    <div style={{ textAlign: "center", padding: 40, color: "var(--text-3)", fontSize: 13 }}>
                      No carrier quotes yet. Use the form below a table section to add quotes.
                      <br />
                      <br />
                      <details style={{ display: "inline-block" }}>
                        <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "6px 16px", border: "1px solid var(--brand)", borderRadius: 6 }}>+ Add first carrier quote</summary>
                        <form action={addCarrierQuoteAction} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "left" }}>
                          <input type="hidden" name="inquiryId" value={selectedInquiry.id} />
                          <input type="hidden" name="quoteType" value="EMAIL" />
                          <input name="carrier" required placeholder="Carrier name" style={inputStyle} />
                          <input name="total40HC" type="number" placeholder="40HC rate ($)" style={inputStyle} />
                          <input name="transitDays" type="number" placeholder="Transit days" style={inputStyle} />
                          <div style={{ gridColumn: "1 / -1" }}>
                            <button type="submit" style={{ padding: "8px 20px", borderRadius: 6, background: "var(--brand)", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add quote</button>
                          </div>
                        </form>
                      </details>
                    </div>
                  )}
                </div>

                {/* Email draft panel at bottom */}
                {selectedInquiry.carrierQuotes.some((q) => q.status === "RECEIVED") && (() => {
                  const received = selectedInquiry.carrierQuotes.filter((q) => q.status === "RECEIVED");
                  const best = received.filter((q) => q.total40HC).reduce<typeof received[0] | null>((b, q) => (!b || (q.total40HC ?? 0) < (b.total40HC ?? Infinity)) ? q : b, null) ?? received[0];
                  if (!best) return null;
                  const margin = marginProfiles[0];
                  const baseRate = best.total40HC ?? best.total40 ?? best.total20 ?? 0;
                  const marginAmt = baseRate * ((margin?.marginPercent ?? 18) / 100);
                  const finalRate = Math.round(baseRate + marginAmt);
                  const emailBody = `Dear ${selectedInquiry.fromCompany ?? "Client"},

Thank you for your inquiry.

We are pleased to provide the following quote:

Route: ${selectedInquiry.origin ?? "—"} → ${selectedInquiry.destination ?? "—"}
Container: ${selectedInquiry.containerType ?? "40HC"}
Carrier: ${best.carrier}
Transit time: ${best.transitDays ? `${best.transitDays} days` : "—"}

Quote: USD ${finalRate.toLocaleString()}
Validity: 48 hours

Please don't hesitate to reach out if you have any questions.

Best regards,
Pricing Team`;

                  return (
                    <div style={{ borderTop: "2px solid var(--border)", background: "var(--surface)" }}>
                      <details>
                        <summary style={{ padding: "14px 24px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, listStyle: "none", background: "var(--surface-3)" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }}></span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Quote ready to send</span>
                          <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 4 }}>Draft email prepared · {best.carrier} @ ${finalRate.toLocaleString()}</span>
                        </summary>
                        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>To</label>
                              <input readOnly value={selectedInquiry.fromEmail ?? ""} style={{ ...inputStyle, background: "var(--surface-3)" }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Subject</label>
                              <input readOnly value={`FCL Quote — ${selectedInquiry.origin ?? ""} → ${selectedInquiry.destination ?? ""} (${selectedInquiry.containerType ?? "40HC"})`} style={{ ...inputStyle, background: "var(--surface-3)" }} />
                            </div>
                          </div>
                          <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Message</label>
                            <textarea readOnly rows={10} value={emailBody} style={{ ...inputStyle, background: "var(--surface-3)", fontFamily: "monospace", resize: "none" }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button style={{ padding: "10px 24px", borderRadius: 7, background: "#111827", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                              Send quote
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: CALCULATOR ───────────────────────────────────────────────── */}
      {tab === "calculator" && (
        <PricingCalculator
          origins={origins}
          destinations={destinations}
          modes={modes}
          marginProfiles={marginProfiles.map((m) => ({ id: m.id, label: m.label, customerTier: m.customerTier, urgency: m.urgency, marginPercent: m.marginPercent }))}
          companies={companies}
          calcResult={calcResult ? {
            matchedLane: calcResult.matchedLane ? { origin: calcResult.matchedLane.origin, destination: calcResult.matchedLane.destination, mode: calcResult.matchedLane.mode, baseAmount: calcResult.matchedLane.baseAmount, currency: calcResult.matchedLane.currency } : null,
            matchedMarginLabel: calcResult.margin?.label ?? null,
            marginPercent: calcResult.margin?.marginPercent ?? 18,
            baseAmount: calcResult.baseAmount, marginAmount: calcResult.marginAmount,
            recommendedAmount: calcResult.recommendedAmount, floorAmount: calcResult.floorAmount,
            currency: calcResult.currency, warnings: calcResult.warnings,
          } : null}
          searchParams={{ origin: sp.origin, destination: sp.destination, mode: sp.mode, tier: sp.tier, urgency: sp.urgency }}
          createQuoteAction={createQuoteFromCalcAction}
        />
      )}

      {/* ── TAB: SETTINGS ─────────────────────────────────────────────────── */}
      {tab === "settings" && (
        <div>
          {/* Lane rates */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)" }}>Lane rates</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "var(--surface-3)", color: "var(--text-3)", border: "1px solid var(--border)" }}>{laneRates.length}</span>
              </div>
              {canManage && (
                <details style={{ position: "relative" }}>
                  <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "4px 12px", border: "1px solid var(--brand)", borderRadius: 6 }}>+ Add lane</summary>
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: 320, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                    <form action={addLaneRateAction} className="field">
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input name="origin" required placeholder="Origin" />
                        <input name="destination" required placeholder="Destination" />
                      </div>
                      <select name="mode" required defaultValue="">
                        <option value="" disabled>Freight mode</option>
                        {modes.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                        <input name="baseAmount" type="number" step="0.01" required placeholder="Base rate" />
                        <input name="currency" defaultValue="USD" />
                      </div>
                      <input name="notes" placeholder="Notes (optional)" />
                      <button type="submit">Add lane rate</button>
                    </form>
                  </div>
                </details>
              )}
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {laneRates.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No lane rates yet.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-3)" }}>
                      {["Route", "Mode", "Base rate", "Currency", "Notes", ""].map((h) => (
                        <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--text-3)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {laneRates.map((r, i) => (
                      <tr key={r.id} style={{ borderBottom: i < laneRates.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <td style={{ padding: "10px 16px", fontWeight: 600 }}>{r.origin} → {r.destination}</td>
                        <td style={{ padding: "10px 16px" }}><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "var(--surface-3)", border: "1px solid var(--border)" }}>{r.mode}</span></td>
                        <td style={{ padding: "10px 16px", fontWeight: 700, color: "var(--brand)" }}>{r.baseAmount.toLocaleString()}</td>
                        <td style={{ padding: "10px 16px", color: "var(--text-3)" }}>{r.currency}</td>
                        <td style={{ padding: "10px 16px", color: "var(--text-3)", fontSize: 12 }}>{r.notes ?? "—"}</td>
                        <td style={{ padding: "10px 16px" }}>
                          {canManage && (
                            <form action={deleteLaneRateAction} style={{ display: "inline" }}>
                              <input type="hidden" name="id" value={r.id} />
                              <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 16, padding: 0 }}>×</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Margin profiles */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)" }}>Margin profiles</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "var(--surface-3)", color: "var(--text-3)", border: "1px solid var(--border)" }}>{marginProfiles.length}</span>
              </div>
              {canManage && (
                <details style={{ position: "relative" }}>
                  <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "4px 12px", border: "1px solid var(--brand)", borderRadius: 6 }}>+ Add profile</summary>
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: 280, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                    <form action={addMarginProfileAction} className="field">
                      <input name="label" required placeholder="Profile name" />
                      <select name="customerTier" defaultValue=""><option value="">Any tier</option><option value="new">New</option><option value="existing">Existing</option><option value="vip">VIP</option></select>
                      <select name="urgency" defaultValue=""><option value="">Any urgency</option><option value="flexible">Flexible</option><option value="normal">Normal</option><option value="asap">ASAP</option></select>
                      <input name="marginPercent" type="number" step="0.1" required placeholder="Margin %" />
                      <button type="submit">Add</button>
                    </form>
                  </div>
                </details>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {marginProfiles.map((m) => (
                <div key={m.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", position: "relative" }}>
                  {canManage && (
                    <form action={deleteMarginProfileAction} style={{ position: "absolute", top: 8, right: 8 }}>
                      <input type="hidden" name="id" value={m.id} />
                      <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 14, padding: 0 }}>×</button>
                    </form>
                  )}
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)", letterSpacing: "-0.03em", marginBottom: 4 }}>{m.marginPercent}%</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{m.label}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {m.customerTier && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-3)", textTransform: "capitalize" }}>{m.customerTier}</span>}
                    {m.urgency && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-3)", textTransform: "capitalize" }}>{m.urgency}</span>}
                    {!m.customerTier && !m.urgency && <span style={{ fontSize: 10, color: "var(--text-3)" }}>Default (all)</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
