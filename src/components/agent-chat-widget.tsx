"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { chatWithAgent, type ChatMsg } from "@/lib/agent-chat";

export function AgentChatWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The dashboard root has a permanent agent panel embedded in the page,
  // so suppress the floating pill there. Must come AFTER all hooks (Rules of Hooks).
  if (pathname === "/dashboard") return null;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await chatWithAgent(messages, text);
      setMessages([...next, { role: "assistant", content: res.reply }]);
      if (res.ingestedInquiryId) {
        router.refresh();
      }
    } catch (err) {
      setMessages([...next, {
        role: "assistant",
        content: `Something went wrong. ${err instanceof Error ? err.message : ""}`,
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

  // Auto-resize textarea
  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="agent-fab"
        aria-label="Open agent"
        title="Open agent (Cmd+J)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>Agent</span>
        <span className="agent-fab-dot" aria-hidden />
      </button>
    );
  }

  return (
    <div className="agent-panel" role="dialog" aria-label="Agent chat">
      <header className="agent-panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="agent-avatar">A</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Agent</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>Connected to your ops</div>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="agent-panel-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </header>

      <div ref={scrollRef} className="agent-panel-body">
        {messages.length === 0 && (
          <div className="agent-empty">
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              Hi. I oversee your pipeline.
            </div>
            <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, marginBottom: 12 }}>
              Ask about active jobs, RFQ status, margins, or what to do next. Paste an inbound RFQ email and I will capture and parse it.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                "What needs my attention right now?",
                "Which jobs are past ETA?",
                "Show me jobs without carrier rates.",
              ].map((q) => (
                <button
                  key={q}
                  className="agent-suggestion"
                  onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0); }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`agent-msg agent-msg-${m.role}`}>
            {m.role === "assistant" && <span className="agent-msg-avatar">A</span>}
            <div className="agent-msg-body">{m.content}</div>
          </div>
        ))}

        {busy && (
          <div className="agent-msg agent-msg-assistant">
            <span className="agent-msg-avatar">A</span>
            <div className="agent-msg-body agent-msg-thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <footer className="agent-panel-footer">
        <textarea
          ref={inputRef}
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder="Ask anything or paste an RFQ email…"
          rows={1}
          disabled={busy}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="agent-send-btn"
          aria-label="Send"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </footer>
    </div>
  );
}
