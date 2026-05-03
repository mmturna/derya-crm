"use client";

import { useState } from "react";

export function DraftModal({
  title, subtitle, draft, onClose,
}: { title: string; subtitle?: string; draft: string; onClose: () => void }) {
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
