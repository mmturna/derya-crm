"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

type Message = {
  id: string;
  direction: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  sentAt: string;
  classification: string | null;
};

export function ThreadAccordion({
  threadId, messageCount, messages,
}: { threadId: string; messageCount: number; messages: Message[] }) {
  const [open, setOpen] = useState(false);

  if (messageCount <= 1) return null;

  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", padding: "8px 16px", textAlign: "left",
          background: "var(--surface-2)", border: "none", cursor: "pointer",
          fontSize: 11.5, color: "var(--text-2)", fontWeight: 500,
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={11} />
        {open ? "Hide" : "Show"} all {messageCount} messages
      </button>
      {open && (
        <div style={{ padding: "10px 16px", background: "var(--surface)", display: "flex", flexDirection: "column", gap: 8 }}>
          {messages.map((m) => (
            <div key={m.id} style={{
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              borderLeft: m.direction === "OUTBOUND" ? "3px solid var(--brand)" : "3px solid var(--text-3)",
              background: m.direction === "OUTBOUND" ? "var(--brand-light)" : "var(--surface)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                  {m.fromName ?? m.fromEmail}
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {m.direction}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {new Date(m.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {m.bodyText && (
                <div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {m.bodyText.length > 600 ? m.bodyText.slice(0, 600) + "…" : m.bodyText}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
