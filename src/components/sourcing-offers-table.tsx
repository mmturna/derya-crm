"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { extractSourcingOffersForInquiry } from "@/lib/sourcing-offers";

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
  offer: Offer | null;
};

export function SourcingOffersTable({ inquiryId, rows }: { inquiryId: string; rows: Row[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();

  function refresh() {
    start(async () => {
      await extractSourcingOffersForInquiry(inquiryId);
      router.refresh();
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
                      <a href={`/dashboard/inbox?thread=${r.threadId}`} style={{ fontSize: 11, color: "var(--brand)", textDecoration: "none" }}>
                        Thread →
                      </a>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
