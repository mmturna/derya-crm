"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { confirmRfqAsJob, mergeRfqIntoExistingJob } from "@/lib/rfq-promote";
import { Icon } from "@/components/icon";

type ActiveJobOption = { id: string; reference: string; type: string; customer: string | null };

export function RfqRowActions({ inquiryId, jobLinked, activeJobs }: {
  inquiryId: string;
  jobLinked: boolean;
  activeJobs: ActiveJobOption[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function doConfirm() {
    start(async () => {
      const r = await confirmRfqAsJob(inquiryId);
      if ("error" in r) { alert(r.error); return; }
      router.push(`/dashboard/jobs/${r.jobId}` as never);
    });
  }
  function pickMerge(targetJobId: string) {
    setOpen(false);
    if (!window.confirm("Merge this RFQ into the selected job? Source RFQ's email threads move onto the target; the source RFQ is deleted.")) return;
    start(async () => {
      const r = await mergeRfqIntoExistingJob({ sourceInquiryId: inquiryId, targetJobId });
      if ("error" in r) { alert(r.error); return; }
      router.refresh();
    });
  }

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? activeJobs.filter((j) => j.reference.toLowerCase().includes(ql) || (j.customer ?? "").toLowerCase().includes(ql))
    : activeJobs.slice(0, 30);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", gap: 4, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      {!jobLinked && (
        <button
          type="button"
          onClick={doConfirm}
          disabled={busy}
          title="Confirm this RFQ as a real Inquiry-stage job"
          style={{
            fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 4,
            background: "var(--brand)", color: "#fff", border: "none", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          <Icon name="check" size={11} strokeWidth={2.5} />
          {busy ? "…" : "Confirm"}
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Merge this RFQ into an existing active job"
        style={{
          fontSize: 11, padding: "4px 8px", borderRadius: 4,
          background: "transparent", color: "var(--text-2)",
          border: "1px solid var(--border)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        <Icon name="layers" size={11} /> Merge into…
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50,
          width: 340, maxHeight: 360, overflow: "hidden", display: "flex", flexDirection: "column",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
        }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search jobs by ref, customer…"
              style={{
                width: "100%", padding: "6px 10px",
                border: "1px solid var(--border)", borderRadius: 4,
                fontSize: 12, outline: "none", background: "var(--surface-2)",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
                No active jobs match.
              </div>
            ) : filtered.map((j) => (
              <button
                key={j.id}
                onClick={() => pickMerge(j.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 12px", background: "transparent", border: "none",
                  fontSize: 12, color: "var(--text)", cursor: "pointer",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{j.reference}{j.customer ? ` · ${j.customer}` : ""}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
                  {j.type === "SOURCING" ? "Procurement" : "Forwarding"}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
