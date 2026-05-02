"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { draftCounterOffer, logOutboundEmail } from "@/lib/job-email";
import { Icon } from "@/components/icon";

export function CounterOfferButton({
  jobId,
  carrierQuoteId,
  carrierName,
}: {
  jobId: string;
  carrierQuoteId: string;
  carrierName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, startSending] = useTransition();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reduction, setReduction] = useState(5);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      const res = await draftCounterOffer(jobId, carrierQuoteId, reduction);
      if ("error" in res) {
        setError(res.error);
      } else {
        setSubject(res.subject);
        setBody(res.body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setDrafting(false);
    }
  }

  function send() {
    if (!subject.trim() || !body.trim()) return;
    const fd = new FormData();
    fd.set("subject", subject);
    fd.set("body", body);
    fd.set("toEmail", toEmail);
    fd.set("toLabel", carrierName);
    startSending(async () => {
      const res = await logOutboundEmail(jobId, fd);
      if ("error" in res) {
        setError(res.error);
      } else {
        setOpen(false);
        setSubject("");
        setBody("");
        router.refresh();
      }
    });
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open && !subject) draft(); }}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 10.5, padding: "2px 6px" }}
        title={`Draft a counter-offer email to ${carrierName}`}
      >
        Counter
      </button>

      {open && (
        <div className="counter-pop">
          <div className="counter-pop-header">
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
                Counter-offer to
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>{carrierName}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>Target reduction</span>
              <select
                value={reduction}
                onChange={(e) => setReduction(Number(e.target.value))}
                style={{ fontSize: 11, padding: "2px 4px" }}
              >
                <option value={3}>3%</option>
                <option value={5}>5%</option>
                <option value={8}>8%</option>
                <option value={10}>10%</option>
              </select>
              <button
                type="button"
                onClick={draft}
                disabled={drafting}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: 10.5, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Icon name="sparkles" size={11} /> {drafting ? "…" : "Re-draft"}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ padding: "8px 12px", fontSize: 11.5, color: "var(--danger)" }}>{error}</div>
          )}

          <div style={{ padding: "8px 12px", display: "flex", gap: 8, borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", textTransform: "uppercase", paddingTop: 5 }}>To</span>
            <input
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder={`${carrierName.toLowerCase().replace(/\s/g, "")}@example.com`}
              style={{ flex: 1, fontSize: 12, border: "none", outline: "none", padding: "4px 0", background: "none" }}
            />
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={drafting ? "Drafting…" : "Subject…"}
            style={{ width: "100%", padding: "8px 12px", fontSize: 12.5, border: "none", outline: "none", borderBottom: "1px solid var(--border)", fontWeight: 600 }}
          />

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={drafting ? "Drafting…" : "Body…"}
            rows={9}
            style={{
              width: "100%", border: "none", outline: "none",
              padding: "10px 12px", fontSize: 12.5, fontFamily: "inherit",
              resize: "vertical", minHeight: 160,
            }}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <button onClick={() => setOpen(false)} className="btn btn-secondary btn-sm" style={{ fontSize: 11.5 }}>Cancel</button>
            <button
              onClick={send}
              disabled={sending || !subject.trim() || !body.trim()}
              className="btn btn-sm"
              style={{ fontSize: 11.5 }}
            >{sending ? "Logging…" : "Send & log"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
