"use client";

import { useState, useTransition } from "react";
import { ensurePortalToken, rotatePortalToken, setNotifyCustomer } from "@/lib/portal";
import { Icon } from "@/components/icon";

export function PortalLinkButton({ jobId, hasToken, notifyCustomer }: { jobId: string; hasToken: boolean; notifyCustomer: boolean }) {
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notify, setNotify] = useState(notifyCustomer);

  function show() {
    setOpen(true);
    if (!link) {
      start(async () => {
        const r = await ensurePortalToken(jobId);
        if ("ok" in r) setLink(r.url);
      });
    }
  }
  function rotate() {
    if (!confirm("Rotate the portal link? The old URL will stop working immediately.")) return;
    start(async () => {
      const r = await rotatePortalToken(jobId);
      if ("ok" in r) setLink(r.url);
    });
  }
  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  function toggleNotify() {
    const next = !notify;
    setNotify(next);
    start(async () => { await setNotifyCustomer(jobId, next); });
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
        title="Get a public read-only link to share with the customer"
      >
        <Icon name="external" size={11} />
        Customer portal
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--surface)", borderRadius: 8, width: "min(580px, 92vw)",
            padding: 0, boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Customer portal</div>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <div style={{ padding: 18 }}>
              <p style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 14 }}>
                A read-only public page showing pipeline, milestones, ETD/ETA. Anyone with the link can view; rotate it any time to revoke.
              </p>
              {link ? (
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      flex: 1, padding: "8px 10px", border: "1px solid var(--border)",
                      borderRadius: 4, fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace",
                      background: "var(--surface-2)",
                    }}
                  />
                  <button onClick={copy} className="btn btn-sm" style={{ fontSize: 12 }}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                    Open <Icon name="external" size={11} />
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 14 }}>{busy ? "Generating link…" : "Loading…"}</div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={notify} onChange={toggleNotify} disabled={busy} />
                Auto-email customer on key status changes (Booked / In transit / Customs / Delivered) and on confirmed ETD/ETA/Delivery milestones.
              </label>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                <button onClick={rotate} className="btn btn-secondary btn-sm" style={{ fontSize: 11.5 }} disabled={busy || !hasToken}>
                  Rotate link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
