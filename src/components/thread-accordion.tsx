"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

type Attachment = { filename: string; mimeType: string; size: number; attachmentId: string };

type Message = {
  id: string;
  direction: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  sentAt: string;
  classification: string | null;
  gmailMessageId: string | null;
  attachments: Attachment[];
};

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ThreadAccordion({
  messageCount, messages,
}: { threadId: string; messageCount: number; messages: Message[] }) {
  const [open, setOpen] = useState(false);
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());

  function toggleBody(id: string) {
    setExpandedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

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
        {open ? "Hide" : "Show"} full thread ({messageCount} {messageCount === 1 ? "message" : "messages"})
      </button>
      {open && (
        <div style={{ padding: "10px 16px", background: "var(--surface)", display: "flex", flexDirection: "column", gap: 8 }}>
          {messages.map((m) => {
            const expanded = expandedBodies.has(m.id);
            const longBody = (m.bodyText?.length ?? 0) > 1200;
            const shownBody = !longBody || expanded ? m.bodyText : (m.bodyText ?? "").slice(0, 1200);
            return (
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
                    {m.fromName && (
                      <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--text-3)", fontWeight: 400 }}>
                        &lt;{m.fromEmail}&gt;
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {new Date(m.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {m.subject && (
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 6, fontWeight: 500 }}>
                    {m.subject}
                  </div>
                )}
                {shownBody && (
                  <div style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                    {shownBody}
                    {longBody && !expanded && <>…</>}
                  </div>
                )}
                {longBody && (
                  <button
                    type="button"
                    onClick={() => toggleBody(m.id)}
                    style={{
                      marginTop: 6, fontSize: 11, color: "var(--brand)",
                      background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500,
                    }}
                  >
                    {expanded ? "Show less" : `Show full email (${m.bodyText?.length.toLocaleString()} chars)`}
                  </button>
                )}
                {m.attachments.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {m.attachments.map((a) => {
                      const dl = m.gmailMessageId
                        ? `/api/gmail/attachment?messageDbId=${m.id}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`
                        : null;
                      return dl ? (
                        <a
                          key={a.attachmentId}
                          href={dl}
                          download={a.filename}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            padding: "5px 10px", borderRadius: 4,
                            background: "var(--surface-2)", border: "1px solid var(--border)",
                            fontSize: 11.5, color: "var(--text)", textDecoration: "none",
                          }}
                        >
                          <Icon name="paperclip" size={11} />
                          <span style={{ fontWeight: 500 }}>{a.filename}</span>
                          <span style={{ color: "var(--text-3)" }}>{formatBytes(a.size)}</span>
                          <Icon name="download" size={11} />
                        </a>
                      ) : (
                        <span key={a.attachmentId} style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "5px 10px", borderRadius: 4,
                          background: "var(--surface-2)", border: "1px solid var(--border)",
                          fontSize: 11.5, color: "var(--text-3)",
                        }}>
                          <Icon name="paperclip" size={11} />
                          {a.filename} · {formatBytes(a.size)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
