"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";

export type LoadOption =
  | { kind: "job"; id: string; reference: string; type: string; customer: string | null }
  | { kind: "inquiry"; id: string; subject: string; type: string };

export function LoadFilterPicker({
  activeJobId, activeInquiryId,
  openJobs, unlinkedInquiries,
}: {
  activeJobId: string | null;
  activeInquiryId: string | null;
  openJobs: { id: string; reference: string; type: string; customer: string | null }[];
  unlinkedInquiries: { id: string; subject: string; type: string }[];
}) {
  const router = useRouter();
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

  const activeLabel = useMemo(() => {
    if (activeJobId) {
      const j = openJobs.find((x) => x.id === activeJobId);
      return j ? `${j.reference}${j.customer ? ` · ${j.customer}` : ""}` : "Job (not in office)";
    }
    if (activeInquiryId) {
      const i = unlinkedInquiries.find((x) => x.id === activeInquiryId);
      return i ? i.subject : "Inquiry";
    }
    return null;
  }, [activeJobId, activeInquiryId, openJobs, unlinkedInquiries]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return { jobs: openJobs.slice(0, 30), inquiries: unlinkedInquiries.slice(0, 20) };
    return {
      jobs: openJobs.filter((j) =>
        j.reference.toLowerCase().includes(ql) ||
        (j.customer ?? "").toLowerCase().includes(ql)
      ).slice(0, 30),
      inquiries: unlinkedInquiries.filter((i) => i.subject.toLowerCase().includes(ql)).slice(0, 20),
    };
  }, [q, openJobs, unlinkedInquiries]);

  function pickJob(id: string) {
    setOpen(false);
    router.push(`/dashboard/inbox?job=${encodeURIComponent(id)}` as never);
  }
  function pickInquiry(id: string) {
    setOpen(false);
    router.push(`/dashboard/inbox?inquiry=${encodeURIComponent(id)}` as never);
  }
  function clear() {
    setOpen(false);
    router.push("/dashboard/inbox" as never);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-secondary"
        style={{
          fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
          ...(activeLabel ? { background: "var(--brand-light)", color: "var(--brand)", borderColor: "var(--brand-border)" } : {}),
        }}
      >
        <Icon name="layers" size={12} />
        {activeLabel ? <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeLabel}</span> : "Filter by load"}
        {activeLabel ? (
          <span
            onClick={(e) => { e.stopPropagation(); clear(); }}
            style={{ marginLeft: 4, padding: 2, borderRadius: 3, display: "inline-flex" }}
            title="Clear filter"
          >
            <Icon name="x" size={11} />
          </span>
        ) : (
          <Icon name="chevron-down" size={11} />
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50,
          width: 380, maxHeight: 480, overflow: "hidden", display: "flex", flexDirection: "column",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
        }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by ref, customer, or subject…"
              style={{
                width: "100%", padding: "7px 10px",
                border: "1px solid var(--border)", borderRadius: 4,
                fontSize: 12.5, outline: "none", background: "var(--surface-2)",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.jobs.length === 0 && filtered.inquiries.length === 0 && (
              <div style={{ padding: 20, fontSize: 12.5, color: "var(--text-3)", textAlign: "center" }}>
                No matches.
              </div>
            )}
            {filtered.jobs.length > 0 && (
              <>
                <SectionLabel>Active jobs</SectionLabel>
                {filtered.jobs.map((j) => (
                  <Row
                    key={j.id}
                    onClick={() => pickJob(j.id)}
                    primary={`${j.reference}${j.customer ? ` · ${j.customer}` : ""}`}
                    secondary={j.type === "SOURCING" ? "Procurement" : "Forwarding"}
                    active={activeJobId === j.id}
                  />
                ))}
              </>
            )}
            {filtered.inquiries.length > 0 && (
              <>
                <SectionLabel>Open inquiries (no job)</SectionLabel>
                {filtered.inquiries.map((i) => (
                  <Row
                    key={i.id}
                    onClick={() => pickInquiry(i.id)}
                    primary={i.subject}
                    secondary={i.type === "SOURCING" ? "Procurement" : "Forwarding"}
                    active={activeInquiryId === i.id}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "8px 12px 4px",
      fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
      color: "var(--text-3)",
    }}>{children}</div>
  );
}

function Row({ onClick, primary, secondary, active }: { onClick: () => void; primary: string; secondary: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "8px 12px", background: active ? "var(--brand-light)" : "transparent",
        border: "none", cursor: "pointer", borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: active ? "var(--brand)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {primary}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
        {secondary}
      </div>
    </button>
  );
}
