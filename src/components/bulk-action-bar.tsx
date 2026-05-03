"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribe, getSelected, clear } from "./bulk-select-store";
import { bulkHideThreads, bulkSnoozeThreads, bulkLinkThreadsToInquiry } from "@/lib/thread-actions";
import { Icon } from "@/components/icon";

type OpenInquiry = { id: string; subject: string; type: string };

export function BulkActionBar({ inquiries }: { inquiries: OpenInquiry[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [count, setCount] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => subscribe(() => setCount(getSelected().length)), []);

  if (count === 0) return null;

  function done() {
    clear();
    router.refresh();
  }

  function hide() {
    start(async () => {
      const ids = getSelected();
      await bulkHideThreads(ids);
      done();
    });
  }
  function snooze(until: "4h" | "tomorrow" | "monday") {
    start(async () => {
      const ids = getSelected();
      await bulkSnoozeThreads(ids, until);
      done();
    });
  }
  function linkTo(inquiryId: string) {
    start(async () => {
      const ids = getSelected();
      await bulkLinkThreadsToInquiry(ids, inquiryId);
      setLinkOpen(false);
      done();
    });
  }

  return (
    <div style={{
      position: "sticky", top: 8, zIndex: 30,
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px", marginBottom: 12,
      background: "var(--text)", color: "#fff", borderRadius: 6,
      boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{count} selected</span>
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.2)" }} />
      <button onClick={hide} disabled={busy} style={btnStyle()}>
        <Icon name="x" size={11} /> Hide
      </button>
      <BulkDropdown
        label={<><Icon name="clock" size={11} /> Snooze</>}
        options={[
          { label: "4 hours", on: () => snooze("4h") },
          { label: "Tomorrow 9am", on: () => snooze("tomorrow") },
          { label: "Next Monday", on: () => snooze("monday") },
        ]}
        disabled={busy}
      />
      <button
        onClick={() => setLinkOpen((o) => !o)}
        disabled={busy || inquiries.length === 0}
        style={btnStyle()}
        title={inquiries.length === 0 ? "No open inquiries to link to" : undefined}
      >
        <Icon name="layers" size={11} /> Link to load
      </button>
      <div style={{ marginLeft: "auto" }}>
        <button onClick={done} style={btnStyle("outline")}>Clear</button>
      </div>
      {linkOpen && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 80,
          background: "var(--surface)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
          minWidth: 320, maxHeight: 320, overflowY: "auto",
          zIndex: 40,
        }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
            Link {count} thread{count === 1 ? "" : "s"} to…
          </div>
          {inquiries.map((i) => (
            <button
              key={i.id}
              onClick={() => linkTo(i.id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 14px", background: "transparent", border: "none",
                fontSize: 12.5, color: "var(--text)", cursor: "pointer",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.subject}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{i.type}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function btnStyle(variant: "solid" | "outline" = "solid"): React.CSSProperties {
  return variant === "outline"
    ? {
        fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 4,
        background: "transparent", color: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(255,255,255,0.3)", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 4,
      }
    : {
        fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 4,
        background: "rgba(255,255,255,0.12)", color: "#fff",
        border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 4,
      };
}

function BulkDropdown({ label, options, disabled }: {
  label: React.ReactNode;
  options: { label: string; on: () => void }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} style={btnStyle()}>{label}</button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "var(--surface)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
          minWidth: 160, zIndex: 40,
        }}>
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => { setOpen(false); o.on(); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 12px", background: "transparent", border: "none",
                fontSize: 12, color: "var(--text)", cursor: "pointer",
              }}
            >{o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
