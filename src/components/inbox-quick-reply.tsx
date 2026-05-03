"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { draftReplyToMessage } from "@/lib/sourcing-award";
import { DraftModal } from "@/components/draft-modal";

export function InboxQuickReply({ threadId, threadSubject }: { threadId: string; threadSubject: string }) {
  const [busy, start] = useTransition();
  const [intent, setIntent] = useState("");
  const [showIntent, setShowIntent] = useState(false);
  const [draft, setDraft] = useState<{ draft: string; replyTo: string | null } | null>(null);

  function go(useIntent: boolean) {
    start(async () => {
      const r = await draftReplyToMessage({
        threadId,
        intent: useIntent ? intent : undefined,
      });
      if ("error" in r) { alert(r.error); return; }
      setDraft({ draft: r.draft, replyTo: r.replyTo });
      setShowIntent(false);
      setIntent("");
    });
  }

  return (
    <>
      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
        {!showIntent ? (
          <>
            <button
              type="button"
              onClick={() => go(false)}
              disabled={busy}
              style={{
                fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 4,
                background: "var(--surface)", color: "var(--brand)",
                border: "1px solid var(--brand-border)", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
              title="AI drafts a reply based on the latest message"
            >
              <Icon name="sparkles" size={11} />
              {busy ? "Drafting…" : "AI reply"}
            </button>
            <button
              type="button"
              onClick={() => setShowIntent(true)}
              disabled={busy}
              style={{
                fontSize: 11, padding: "4px 7px", borderRadius: 4,
                background: "transparent", color: "var(--text-3)",
                border: "1px solid var(--border)", cursor: "pointer",
              }}
              title="Tell the AI what stance to take"
            >
              + intent
            </button>
          </>
        ) : (
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={intent}
              autoFocus
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); go(true); }
                if (e.key === "Escape") { setShowIntent(false); setIntent(""); }
              }}
              placeholder="counter at $480/MT, ask for sample…"
              style={{
                fontSize: 11.5, padding: "4px 8px", borderRadius: 4,
                border: "1px solid var(--brand)", outline: "none",
                width: 260, background: "var(--surface)",
              }}
            />
            <button
              type="button"
              onClick={() => go(true)}
              disabled={busy || !intent.trim()}
              style={{
                fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 4,
                background: "var(--brand)", color: "#fff", border: "none", cursor: "pointer",
              }}
            >
              {busy ? "…" : "Draft"}
            </button>
            <button
              type="button"
              onClick={() => { setShowIntent(false); setIntent(""); }}
              style={{
                fontSize: 11, padding: "4px 7px", borderRadius: 4,
                background: "transparent", color: "var(--text-3)",
                border: "1px solid var(--border)", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {draft && (
        <DraftModal
          title={`Reply draft — ${threadSubject}`}
          subtitle={draft.replyTo ? `To: ${draft.replyTo}` : ""}
          draft={draft.draft}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
