"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendReplyToThread } from "@/lib/gmail-send";

export function DraftModal({
  title, subtitle, draft, onClose,
  threadDbId, replyTo,
}: {
  title: string;
  subtitle?: string;
  draft: string;
  onClose: () => void;
  /** If provided, "Send" button appears and uses Gmail send to deliver as a real reply. */
  threadDbId?: string;
  replyTo?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft);
  const [busy, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string; needsReauth?: boolean } | null>(null);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function send() {
    if (!threadDbId) return;
    if (!text.trim()) { setStatus({ kind: "err", msg: "Draft is empty" }); return; }
    start(async () => {
      setStatus(null);
      const r = await sendReplyToThread({
        threadDbId,
        body: text,
        replyTo: replyTo ?? undefined,
      });
      if ("error" in r) {
        setStatus({ kind: "err", msg: r.error, needsReauth: r.needsReauth });
        return;
      }
      setStatus({ kind: "ok", msg: "Sent" });
      router.refresh();
      setTimeout(onClose, 1200);
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
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, color: status?.kind === "err" ? "var(--danger)" : "var(--text-3)", flex: 1, minWidth: 0 }}>
            {status?.msg}
            {status?.needsReauth && (
              <>
                {" "}
                <a href="/dashboard/settings/email" style={{ color: "var(--brand)", fontWeight: 600 }}>Reconnect inbox →</a>
              </>
            )}
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }} disabled={busy}>Close</button>
          <button onClick={copy} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }} disabled={busy}>
            {copied ? "Copied" : "Copy"}
          </button>
          {threadDbId && (
            <button onClick={send} className="btn btn-sm" style={{ fontSize: 12 }} disabled={busy}>
              {busy ? "Sending…" : status?.kind === "ok" ? "Sent ✓" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
