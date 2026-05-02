"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reclassifyMessages } from "@/lib/gmail-sync";

export function ReclassifyButton({ onlyUnclassified = false }: { onlyUnclassified?: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    startTransition(async () => {
      setMsg(null);
      const res = await reclassifyMessages({ onlyUnclassified, limit: 50 });
      if ("error" in res) {
        setMsg(res.error);
      } else {
        const ai = res.autoInquiries > 0 ? ` · +${res.autoInquiries} new inquiries` : "";
        setMsg(`Re-classified ${res.processed} · ${res.relinked} re-linked${ai}`);
        router.refresh();
        setTimeout(() => setMsg(null), 6000);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {msg && <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{msg}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12 }}
      >
        {busy ? "Re-classifying…" : (onlyUnclassified ? "Classify missing" : "Re-classify all")}
      </button>
    </div>
  );
}
