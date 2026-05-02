"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { consolidateDuplicateInquiries } from "@/lib/merge-actions";
import { Icon } from "@/components/icon";

export function MergeDuplicatesButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    start(async () => {
      setMsg(null);
      const r = await consolidateDuplicateInquiries();
      if ("error" in r) {
        setMsg(r.error);
      } else if (r.merged === 0) {
        setMsg("No duplicates found");
        setTimeout(() => setMsg(null), 4000);
      } else {
        setMsg(`Merged ${r.merged} duplicate${r.merged === 1 ? "" : "s"} into ${r.clusters} deal${r.clusters === 1 ? "" : "s"}`);
        router.refresh();
        setTimeout(() => setMsg(null), 6000);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{msg}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Icon name="layers" size={11} />
        {busy ? "Merging…" : "Merge duplicates"}
      </button>
    </div>
  );
}
