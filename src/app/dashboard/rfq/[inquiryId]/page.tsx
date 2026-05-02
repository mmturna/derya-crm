import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { convertToJob, updateInquiryField, updateInquiryStatus, parseRFQWithAI } from "./actions";
import { Icon } from "@/components/icon";
import { SourcingOffersTable } from "@/components/sourcing-offers-table";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  INGESTED: { label: "New",    cls: "badge-info" },
  PARSED:   { label: "Parsed", cls: "badge-neutral" },
  PRICED:   { label: "Priced", cls: "badge-warn" },
  QUOTED:   { label: "Quoted", cls: "badge-good" },
  WON:      { label: "Won",    cls: "badge-good" },
  LOST:     { label: "Lost",   cls: "badge-danger" },
};

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function RFQDetailPage({
  params,
}: {
  params: Promise<{ inquiryId: string }>;
}) {
  const session = await requireSession();
  const { inquiryId } = await params;

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: {
      company: { select: { id: true, name: true } },
      carrierQuotes: { orderBy: { createdAt: "asc" } },
      job: { select: { id: true, reference: true, status: true } },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
    },
  });

  if (!inquiry) notFound();

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const sm = STATUS_META[inquiry.status] ?? { label: inquiry.status, cls: "badge-neutral" };
  const canConvert = !inquiry.job && !["WON", "LOST"].includes(inquiry.status);

  const FLOW_HINTS: Record<string, { msg: string; action: string }> = {
    INGESTED: { msg: "This RFQ hasn't been parsed yet.", action: "Parse with AI to extract origin, destination, mode and cargo details." },
    PARSED:   { msg: "Fields are extracted — ready to price.", action: "Add carrier rates in the Procurement tab after converting, or convert directly." },
    PRICED:   { msg: "Carrier rates collected.", action: "Convert to a Job to start the shipment process." },
    QUOTED:   { msg: "Quote has been sent to the customer.", action: "Waiting for customer reply. Mark as Won or Lost when outcome is known." },
  };
  const flowHint = !inquiry.job ? FLOW_HINTS[inquiry.status] : null;

  return (
    <div>
      {/* Back */}
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard/rfq" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          RFQ Inbox
        </a>
      </div>

      {/* Flow hint banner */}
      {flowHint && (
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
          padding: "12px 16px", borderRadius: "var(--radius)", marginBottom: 16,
          background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--brand)",
        }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{flowHint.msg}</span>
            {" "}
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>{flowHint.action}</span>
          </div>
          {inquiry.status === "INGESTED" && inquiry.rawEmailBody && (
            <form action={parseRFQWithAI.bind(null, inquiry.id)} style={{ flexShrink: 0 }}>
              <button className="btn" type="submit" style={{ fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="sparkles" size={12} strokeWidth={2} /> Parse with AI
              </button>
            </form>
          )}
        </div>
      )}

      {/* Header */}
      <div className="card" style={{ marginBottom: 20, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className={`badge ${sm.cls}`}>{sm.label}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{fmt(inquiry.receivedAt)}</span>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, wordBreak: "break-word" }}>{inquiry.subject}</h1>
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>
              {inquiry.fromEmail ?? inquiry.fromCompany ?? "Unknown sender"}
              {inquiry.company && ` · ${inquiry.company.name}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {inquiry.job ? (
              <a href={`/dashboard/jobs/${inquiry.job.id}`} className="btn" style={{ fontSize: 13 }}>
                → Job {inquiry.job.reference}
              </a>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <form action={updateInquiryStatus.bind(null, inquiryId, "LOST")}>
                  <button className="btn btn-secondary btn-sm" type="submit">Mark Lost</button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        {/* Left: email body + parsed fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Raw email */}
          {inquiry.rawEmailBody && (
            <div className="card">
              <div className="card-body">
                <div className="section-title" style={{ marginBottom: 12 }}>Email Content</div>
                <div style={{
                  fontSize: 13, lineHeight: 1.65, color: "var(--text-2)",
                  whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto",
                  padding: 14, background: "var(--surface-2)", borderRadius: "var(--radius)",
                  border: "1px solid var(--border)", fontFamily: "monospace",
                }}>
                  {inquiry.rawEmailBody}
                </div>
              </div>
            </div>
          )}

          {/* Sourcing comparison table — only for SOURCING inquiries */}
          {inquiry.type === "SOURCING" && (
            <SourcingOffersTable
              inquiryId={inquiry.id}
              rows={inquiry.emailThreads.map((t) => {
                let offer: Record<string, unknown> | null = null;
                if (t.supplierOffer) {
                  try { offer = JSON.parse(t.supplierOffer); } catch { offer = null; }
                }
                const firstInbound = t.messages.find((m) => m.direction === "INBOUND");
                return {
                  threadId: t.id,
                  threadSubject: t.subject,
                  fromEmail: firstInbound?.fromEmail ?? null,
                  lastMessageAt: t.lastMessageAt.toISOString(),
                  offer: offer as never,
                };
              })}
            />
          )}

          {/* Email threads */}
          {inquiry.emailThreads.length > 0 && (
            <div className="email-thread">
              {inquiry.emailThreads.map((thread) =>
                thread.messages.map((msg) => {
                  let attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
                  if (msg.attachments) {
                    try { attachments = JSON.parse(msg.attachments); } catch { attachments = []; }
                  }
                  return (
                    <div key={msg.id} className={`email-bubble ${msg.direction === "INBOUND" ? "email-inbound" : ""}`}>
                      <div className="email-bubble-header">
                        <div>
                          <div className="email-bubble-from">{msg.fromName ?? msg.fromEmail}</div>
                          <div className="email-bubble-meta">{msg.fromEmail} · {msg.direction}</div>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                          {new Date(msg.sentAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="email-bubble-body">{msg.bodyText ?? msg.bodyHtml ?? "—"}</div>
                      {attachments.length > 0 && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {attachments.map((a) => (
                            <a
                              key={a.attachmentId}
                              href={`/api/gmail/attachment?messageDbId=${msg.id}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`}
                              download={a.filename}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                padding: "4px 9px", borderRadius: 4,
                                background: "var(--surface-2)", border: "1px solid var(--border)",
                                fontSize: 11.5, color: "var(--text)", textDecoration: "none",
                              }}
                            >
                              <Icon name="paperclip" size={11} />
                              <span style={{ fontWeight: 500 }}>{a.filename}</span>
                              <span style={{ color: "var(--text-3)" }}>
                                {a.size < 1024 * 1024 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / 1024 / 1024).toFixed(1)} MB`}
                              </span>
                              <Icon name="download" size={11} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Parsed / editable fields */}
          <div className="card">
            <div className="card-body">
              <div className="section-title" style={{ marginBottom: 14 }}>Parsed Fields</div>
              <form action={updateInquiryField.bind(null, inquiryId)}>
                <div className="form-grid-2" style={{ marginBottom: 12 }}>
                  <label className="field"><span>Origin</span>
                    <input name="origin" defaultValue={inquiry.origin ?? ""} placeholder="e.g. Shanghai, CN" />
                  </label>
                  <label className="field"><span>Destination</span>
                    <input name="destination" defaultValue={inquiry.destination ?? ""} placeholder="e.g. Hamburg, DE" />
                  </label>
                </div>
                <div className="form-grid-3" style={{ marginBottom: 12 }}>
                  <label className="field"><span>Mode</span>
                    <select name="mode" defaultValue={inquiry.mode ?? ""}>
                      <option value="">— Select —</option>
                      <option value="SEA-FCL">Sea FCL</option>
                      <option value="SEA-LCL">Sea LCL</option>
                      <option value="AIR">Air</option>
                      <option value="ROAD">Road</option>
                      <option value="COURIER">Courier</option>
                    </select>
                  </label>
                  <label className="field"><span>Container</span>
                    <select name="containerType" defaultValue={inquiry.containerType ?? ""}>
                      <option value="">— Select —</option>
                      <option value="20GP">20GP</option>
                      <option value="40GP">40GP</option>
                      <option value="40HC">40HC</option>
                      <option value="LCL">LCL</option>
                    </select>
                  </label>
                  <label className="field"><span>Incoterms</span>
                    <select name="incoterms" defaultValue={inquiry.incoterms ?? ""}>
                      <option value="">— Select —</option>
                      {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid-3" style={{ marginBottom: 12 }}>
                  <label className="field"><span>Commodity</span>
                    <input name="commodity" defaultValue={inquiry.commodity ?? ""} placeholder="e.g. Electronics" />
                  </label>
                  <label className="field"><span>Weight (kg)</span>
                    <input name="weight" type="number" defaultValue={inquiry.weight ?? ""} placeholder="0" />
                  </label>
                  <label className="field"><span>Volume (cbm)</span>
                    <input name="volume" type="number" defaultValue={inquiry.volume ?? ""} placeholder="0" />
                  </label>
                </div>
                <label className="field" style={{ marginBottom: 12 }}><span>Notes</span>
                  <textarea name="notes" defaultValue={inquiry.notes ?? ""} rows={3} placeholder="Internal notes…" />
                </label>
                <button className="btn btn-secondary" type="submit">Save Fields</button>
              </form>
            </div>
          </div>
        </div>

        {/* Right: Convert to Job + carrier quotes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Convert to Job */}
          {canConvert ? (
            <div className="card" style={{ border: "2px solid var(--brand)" }}>
              <div className="card-body">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  </div>
                  <div className="section-title">Convert to Job</div>
                </div>
                <form action={convertToJob.bind(null, inquiryId)}>
                  <label className="field" style={{ marginBottom: 12 }}>
                    <span>Customer</span>
                    <select name="companyId" defaultValue={inquiry.companyId ?? ""}>
                      <option value="">— Link to customer —</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid-2" style={{ marginBottom: 12 }}>
                    <label className="field"><span>Origin</span>
                      <input name="origin" defaultValue={inquiry.origin ?? ""} required placeholder="City, CC" />
                    </label>
                    <label className="field"><span>Destination</span>
                      <input name="destination" defaultValue={inquiry.destination ?? ""} required placeholder="City, CC" />
                    </label>
                  </div>
                  <div className="form-grid-2" style={{ marginBottom: 14 }}>
                    <label className="field"><span>Mode</span>
                      <select name="mode" defaultValue={inquiry.mode ?? ""}>
                        <option value="">— Select —</option>
                        <option value="SEA-FCL">Sea FCL</option>
                        <option value="SEA-LCL">Sea LCL</option>
                        <option value="AIR">Air</option>
                        <option value="ROAD">Road</option>
                        <option value="COURIER">Courier</option>
                      </select>
                    </label>
                    <label className="field"><span>Incoterms</span>
                      <select name="incoterms" defaultValue={inquiry.incoterms ?? ""}>
                        <option value="">— Select —</option>
                        {["EXW","FCA","FOB","CFR","CIF","DAP","DDP"].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button className="btn" type="submit" style={{ width: "100%", justifyContent: "center" }}>
                    → Create Job from RFQ
                  </button>
                </form>
              </div>
            </div>
          ) : inquiry.job ? (
            <div className="card" style={{ border: "1px solid var(--border)", borderLeft: "3px solid var(--brand)" }}>
              <div className="card-body">
                <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="check" size={14} strokeWidth={2.5} /> Converted to Job
                </div>
                <a href={`/dashboard/jobs/${inquiry.job.id}`} style={{ color: "var(--brand)", fontWeight: 600, fontSize: 14 }}>
                  {inquiry.job.reference} →
                </a>
              </div>
            </div>
          ) : null}

          {/* Carrier quotes summary */}
          {inquiry.carrierQuotes.length > 0 && (
            <div className="card">
              <div className="card-body">
                <div className="section-title" style={{ marginBottom: 12 }}>Carrier Rates Received</div>
                {inquiry.carrierQuotes.map((q) => (
                  <div key={q.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{q.carrier}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{q.service ?? ""} {q.transitDays ? `· ${q.transitDays}d` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {q.total40HC ? `$${q.total40HC.toLocaleString()}` : q.total40 ? `$${q.total40.toLocaleString()}` : q.total20 ? `$${q.total20.toLocaleString()}` : "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>40HC / 40 / 20</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta info */}
          <div className="card">
            <div className="card-body">
              <div className="section-title" style={{ marginBottom: 12 }}>Details</div>
              {[
                { label: "From",       value: inquiry.fromEmail ?? inquiry.fromCompany ?? "—" },
                { label: "Received",   value: fmt(inquiry.receivedAt) },
                { label: "Cargo Ready",value: inquiry.cargoReadyDate ? fmt(inquiry.cargoReadyDate) : "—" },
                { label: "Container",  value: inquiry.containerType ?? "—" },
                { label: "Status",     value: sm.label },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <span style={{ color: "var(--text-3)", fontWeight: 500 }}>{label}</span>
                  <span style={{ fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
