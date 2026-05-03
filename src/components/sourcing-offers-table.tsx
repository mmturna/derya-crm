"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { extractSourcingOffersForInquiry } from "@/lib/sourcing-offers";
import { awardSupplier, draftReplyToMessage } from "@/lib/sourcing-award";

type Offer = {
  supplierName?: string | null;
  pricePerUnit?: number | null;
  currency?: string | null;
  unit?: string | null;
  qtyAvailable?: string | null;
  incoterms?: string | null;
  paymentTerms?: string | null;
  origin?: string | null;
  leadTime?: string | null;
  validity?: string | null;
  sampleAvailable?: boolean | null;
  notes?: string | null;
  hasNoOffer?: boolean;
};

type Row = {
  threadId: string;
  threadSubject: string;
  fromEmail: string | null;
  lastMessageAt: string;
  awardedAt: string | null;
  offer: Offer | null;
};

export function SourcingOffersTable({ inquiryId, rows }: { inquiryId: string; rows: Row[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [awardModal, setAwardModal] = useState<{ threadId: string; supplierName: string; draft: string; replyTo: string | null } | null>(null);
  const [replyModal, setReplyModal] = useState<{ threadId: string; supplierName: string; draft: string; replyTo: string | null } | null>(null);

  function refresh() {
    start(async () => {
      await extractSourcingOffersForInquiry(inquiryId);
      router.refresh();
    });
  }
  function award(row: Row) {
    if (!confirm(`Award the deal to ${row.offer?.supplierName ?? row.fromEmail ?? "this supplier"}? This sets the job to "Awarded" and drafts a confirmation email.`)) return;
    start(async () => {
      const r = await awardSupplier(row.threadId);
      if ("error" in r) { alert(r.error); return; }
      setAwardModal({
        threadId: row.threadId,
        supplierName: row.offer?.supplierName ?? row.fromEmail ?? "Supplier",
        draft: r.emailDraft,
        replyTo: row.fromEmail,
      });
      router.refresh();
    });
  }
  function draftReply(row: Row, intent?: string) {
    start(async () => {
      const r = await draftReplyToMessage({ threadId: row.threadId, intent });
      if ("error" in r) { alert(r.error); return; }
      setReplyModal({
        threadId: row.threadId,
        supplierName: row.offer?.supplierName ?? row.fromEmail ?? "Supplier",
        draft: r.draft,
        replyTo: r.replyTo,
      });
    });
  }

  // Cheapest first if priced
  const sorted = [...rows].sort((a, b) => {
    const ap = a.offer?.pricePerUnit ?? Infinity;
    const bp = b.offer?.pricePerUnit ?? Infinity;
    return ap - bp;
  });

  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="section-title">Supplier Offers</div>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              No supplier email threads linked to this sourcing inquiry yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const fmtPrice = (o: Offer | null) =>
    o?.pricePerUnit != null ? `${o.currency ?? ""} ${o.pricePerUnit.toLocaleString()}${o.unit ? `/${o.unit}` : ""}`.trim() : "—";

  return (
    <div className="card">
      <div className="card-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="section-title">Supplier Offers</div>
            <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
              {rows.length} supplier thread{rows.length === 1 ? "" : "s"} · cheapest first when priced
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="sparkles" size={11} />
            {busy ? "Extracting…" : "Re-extract with AI"}
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                <Th>Supplier</Th>
                <Th>Price</Th>
                <Th>Qty</Th>
                <Th>Origin</Th>
                <Th>Incoterms</Th>
                <Th>Payment</Th>
                <Th>Lead</Th>
                <Th>Valid</Th>
                <Th>Sample</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const o = r.offer;
                const isBest = i === 0 && o?.pricePerUnit != null;
                return (
                  <tr
                    key={r.threadId}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: isBest ? "var(--brand-light)" : undefined,
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>
                        {o?.supplierName ?? r.fromEmail ?? "—"}
                        {isBest && (
                          <span style={{
                            marginLeft: 6, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                            background: "var(--brand)", color: "#fff",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                          }}>BEST</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{r.threadSubject}</div>
                    </Td>
                    <Td><span style={{ fontWeight: 600 }}>{fmtPrice(o)}</span></Td>
                    <Td>{o?.qtyAvailable ?? "—"}</Td>
                    <Td>{o?.origin ?? "—"}</Td>
                    <Td>{o?.incoterms ?? "—"}</Td>
                    <Td>{o?.paymentTerms ?? "—"}</Td>
                    <Td>{o?.leadTime ?? "—"}</Td>
                    <Td>{o?.validity ?? "—"}</Td>
                    <Td>
                      {o?.sampleAvailable === true ? <Icon name="check" size={12} /> :
                        o?.sampleAvailable === false ? <span style={{ color: "var(--text-3)" }}>no</span> : "—"}
                    </Td>
                    <Td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                        {r.awardedAt ? (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                            background: "var(--brand)", color: "#fff",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                          }}>Awarded</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => award(r)}
                            disabled={busy}
                            style={{
                              fontSize: 10.5, fontWeight: 600, padding: "3px 8px", borderRadius: 3,
                              background: "var(--brand)", color: "#fff", border: "none", cursor: "pointer",
                            }}
                          >Award</button>
                        )}
                        <button
                          type="button"
                          onClick={() => draftReply(r)}
                          disabled={busy}
                          style={{
                            fontSize: 10.5, padding: "2px 6px", borderRadius: 3,
                            background: "transparent", color: "var(--brand)", border: "1px solid var(--brand-border)", cursor: "pointer",
                          }}
                        >AI reply</button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {awardModal && (
        <DraftModal
          title={`Award confirmation — ${awardModal.supplierName}`}
          subtitle={awardModal.replyTo ? `To: ${awardModal.replyTo}` : ""}
          draft={awardModal.draft}
          onClose={() => setAwardModal(null)}
        />
      )}
      {replyModal && (
        <DraftModal
          title={`Reply draft — ${replyModal.supplierName}`}
          subtitle={replyModal.replyTo ? `To: ${replyModal.replyTo}` : ""}
          draft={replyModal.draft}
          onClose={() => setReplyModal(null)}
        />
      )}
    </div>
  );
}

function DraftModal({ title, subtitle, draft, onClose }: { title: string; subtitle: string; draft: string; onClose: () => void }) {
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", borderRadius: 8,
        width: "min(640px, 92vw)", maxHeight: "85vh",
        boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            flex: 1, minHeight: 280, padding: 16, border: "none", outline: "none",
            fontSize: 13, lineHeight: 1.55, fontFamily: "inherit",
            background: "var(--surface)", color: "var(--text)", resize: "vertical",
          }}
        />
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>Close</button>
          <button onClick={copy} className="btn btn-sm" style={{ fontSize: 12 }}>
            {copied ? "Copied" : "Copy to clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "8px 10px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px 10px", verticalAlign: "top", color: "var(--text)" }}>{children}</td>;
}
