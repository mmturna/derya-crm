"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chatWithAgent, type ChatMsg } from "@/lib/agent-chat";
import { Icon } from "@/components/icon";

export type FeedItem = {
  kind: "event";
  id: string;
  at: string; // ISO
  iconName: "inbox" | "sparkles" | "ship" | "box" | "check" | "file" | "file-check" | "mail-in" | "mail-out";
  who: "auto" | "manual";
  title: string;
  sub?: string;
};

function relTime(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type ChatItem = ChatMsg & { id: string; at: string };

export function JobConversationPanel({
  scopeJobId,
  scopeJobReference,
  feed,
  suggestions,
}: {
  scopeJobId: string;
  scopeJobReference: string;
  feed: FeedItem[];
  suggestions: string[];
}) {
  const router = useRouter();
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat, busy]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const history: ChatMsg[] = chat.map(({ role, content }) => ({ role, content }));
    const userItem: ChatItem = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      at: new Date().toISOString(),
    };
    setChat((c) => [...c, userItem]);
    setBusy(true);
    try {
      const res = await chatWithAgent(history, text, scopeJobId);
      const assistantItem: ChatItem = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: res.reply,
        at: new Date().toISOString(),
      };
      setChat((c) => [...c, assistantItem]);
      if (res.ingestedInquiryId) router.refresh();
    } catch (err) {
      setChat((c) => [...c, {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Something went wrong. ${err instanceof Error ? err.message : ""}`,
        at: new Date().toISOString(),
      }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  // Merge events + chat for chronological display
  type Item = ({ kind: "event" } & FeedItem) | ({ kind: "chat" } & ChatItem);
  const merged: Item[] = [
    ...feed.map((f) => ({ ...f } as Item)),
    ...chat.map((c) => ({ ...c, kind: "chat" as const })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="conversation-panel">
      <header className="conversation-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="agent-avatar">A</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Agent</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              Focused on {scopeJobReference}
            </div>
          </div>
        </div>
        <span className="live-dot" aria-hidden />
      </header>

      <div ref={scrollRef} className="conversation-body">
        {merged.length === 0 ? (
          <div style={{ padding: "20px 4px", fontSize: 13, color: "var(--text-3)" }}>
            No activity yet on this job.
          </div>
        ) : (
          merged.map((item) =>
            item.kind === "event" ? (
              <div key={item.id} className="conv-event">
                <span className={`conv-event-icon ${item.who === "auto" ? "auto" : "manual"}`}>
                  <Icon name={item.iconName} size={12} strokeWidth={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{item.title}</span>
                    {item.who === "auto" && (
                      <span className="auto-tag">AUTO</span>
                    )}
                  </div>
                  {item.sub && (
                    <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1, lineHeight: 1.4 }}>
                      {item.sub}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{relTime(item.at)}</span>
              </div>
            ) : (
              <div key={item.id} className={`conv-chat conv-chat-${item.role}`}>
                {item.role === "assistant" && <span className="agent-msg-avatar">A</span>}
                <div className="conv-chat-body">{item.content}</div>
              </div>
            )
          )
        )}
        {busy && (
          <div className="conv-chat conv-chat-assistant">
            <span className="agent-msg-avatar">A</span>
            <div className="conv-chat-body agent-msg-thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <div className="conversation-compose">
        {chat.length === 0 && suggestions.length > 0 && (
          <div className="conv-suggestions">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
            ))}
          </div>
        )}
        <div className="conv-input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={`Ask about ${scopeJobReference} or paste an RFQ…`}
            rows={1}
            disabled={busy}
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="agent-send-btn"
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
