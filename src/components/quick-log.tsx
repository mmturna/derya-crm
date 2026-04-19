"use client";
import { useRef, useState, useTransition } from "react";
import { AudioUploader } from "./audio-uploader";

const TYPE_BUTTONS = [
  { type: "CALL", label: "Call", color: "#2563eb" },
  { type: "VISIT", label: "Visit", color: "#16a34a" },
  { type: "EMAIL", label: "Email", color: "#9333ea" },
] as const;

export function QuickLog({
  companyId,
  companyName,
  action,
}: {
  companyId: string;
  companyName: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit(type: string) {
    if (!text.trim() && !transcript.trim()) return;
    const fd = new FormData();
    fd.append("companyId", companyId);
    fd.append("type", type);
    fd.append("body", text);
    fd.append("transcript", transcript);
    fd.append("subject", text.split("\n")[0].slice(0, 120));
    fd.append("occurredAt", new Date().toISOString().split("T")[0]);
    setSubmitted(true);
    startTransition(async () => {
      await action(fd);
      setText("");
      setTranscript("");
      setShowAudio(false);
      setSubmitted(false);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <textarea
        placeholder={`What happened with ${companyName}?`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        disabled={isPending}
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1.5px solid var(--border)",
          borderRadius: 8,
          fontSize: 14,
          resize: "none",
          fontFamily: "inherit",
          background: "var(--surface)",
          color: "var(--text)",
          outline: "none",
          transition: "border-color 0.15s",
          boxSizing: "border-box",
        }}
        onFocus={(e) => (e.target.style.borderColor = "var(--brand)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
      />

      {transcript && (
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={3}
          placeholder="Transcript (editable)"
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            resize: "none",
            fontFamily: "inherit",
            background: "var(--surface-2)",
            color: "var(--text-2)",
            boxSizing: "border-box",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {TYPE_BUTTONS.map(({ type, label, color }) => (
          <button
            key={type}
            type="button"
            disabled={isPending || (!text.trim() && !transcript.trim())}
            onClick={() => submit(type)}
            style={{
              padding: "7px 16px",
              borderRadius: 20,
              border: `1.5px solid ${color}`,
              background: "transparent",
              color,
              fontWeight: 700,
              fontSize: 13,
              cursor: isPending || (!text.trim() && !transcript.trim()) ? "not-allowed" : "pointer",
              opacity: isPending || (!text.trim() && !transcript.trim()) ? 0.45 : 1,
              transition: "all 0.12s",
            }}
          >
            {submitted && isPending ? "Saving…" : `Log ${label}`}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowAudio((v) => !v)}
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-3)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 0",
          }}
        >
          {showAudio ? "Hide audio" : "🎙 Voice note"}
        </button>
      </div>

      {showAudio && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <AudioUploader onTranscript={(t) => { setTranscript(t); setShowAudio(false); }} />
        </div>
      )}
    </div>
  );
}
