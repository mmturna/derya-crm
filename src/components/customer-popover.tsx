"use client";

import { useEffect, useRef, useState } from "react";

type Summary = {
  id: string;
  name: string;
  status: string;
  contacts: { id: string; name: string | null; email: string | null; phone: string | null }[];
  jobsCount: number;
  recentJobs: { id: string; reference: string; route: string | null; status: string }[];
};

export function CustomerPopover({ companyId, name }: { companyId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    fetch(`/api/customers/${companyId}/summary`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, data, companyId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontSize: 14, fontWeight: 700, color: "var(--text)",
          textDecoration: "underline", textDecorationColor: "transparent",
          textUnderlineOffset: 3, transition: "text-decoration-color 0.12s",
        }}
        onMouseEnter={(e) => e.currentTarget.style.textDecorationColor = "var(--text-3)"}
        onMouseLeave={(e) => e.currentTarget.style.textDecorationColor = "transparent"}
      >
        {name}
      </button>

      {open && (
        <div className="customer-popover">
          {loading && <div style={{ padding: 18, fontSize: 12.5, color: "var(--text-3)" }}>Loading…</div>}
          {data && (
            <>
              <div className="customer-popover-header">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{data.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {data.jobsCount} {data.jobsCount === 1 ? "job" : "jobs"} · status {data.status.toLowerCase()}
                  </div>
                </div>
                <a href={`/dashboard/customers/${data.id}`} className="btn btn-secondary btn-sm" style={{ fontSize: 11, textDecoration: "none" }}>
                  Profile →
                </a>
              </div>

              {data.contacts.length > 0 && (
                <div className="customer-popover-section">
                  <div className="customer-popover-section-title">Contacts</div>
                  {data.contacts.slice(0, 3).map((c) => (
                    <div key={c.id} style={{ fontSize: 12, padding: "4px 0" }}>
                      <div style={{ fontWeight: 600 }}>{c.name ?? "(no name)"}</div>
                      <div style={{ color: "var(--text-3)", fontSize: 11 }}>
                        {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {data.recentJobs.length > 0 && (
                <div className="customer-popover-section">
                  <div className="customer-popover-section-title">Recent jobs</div>
                  {data.recentJobs.map((j) => (
                    <a key={j.id} href={`/dashboard/jobs/${j.id}`} style={{
                      display: "flex", justifyContent: "space-between", padding: "5px 0",
                      fontSize: 12, color: "inherit", textDecoration: "none",
                    }}>
                      <span style={{ fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>{j.reference}</span>
                      <span style={{ color: "var(--text-3)" }}>{j.route ?? "—"}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
