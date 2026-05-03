"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { setupDemoEnvironment } from "@/lib/setup-demo-actions";

export function SeedDemoButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "ok" | "err">("info");

  function go() {
    if (!confirm("Run demo setup in this office?\n\nThis will:\n· Consolidate every soybean / SOURCING thread into one real load: Soybean meal — 300 MT to Ashgabat\n· Create a separate DEMO · Black Sea Trading Co job with example PDFs\n\nIdempotent — safe to re-run.")) return;
    start(async () => {
      setTone("info");
      setMsg("Setting up…");
      try {
        const r = await setupDemoEnvironment();
        const lines: string[] = [];
        if (r.soybean.ok) {
          lines.push(`Soybean → ${r.soybean.jobRef}${r.soybean.mergedCount ? ` (merged ${r.soybean.mergedCount})` : ""}`);
        } else {
          lines.push(`Soybean error: ${r.soybean.error}`);
        }
        if (r.steelDemo.ok) {
          lines.push(`Demo → ${r.steelDemo.jobRef} ${r.steelDemo.created ? "(new)" : "(existing)"}`);
        } else {
          lines.push(`Demo error: ${r.steelDemo.error}`);
        }
        const allOk = r.soybean.ok && r.steelDemo.ok;
        setTone(allOk ? "ok" : "err");
        setMsg(lines.join(" · "));
        router.refresh();
        if (!allOk) {
          // keep the error visible
        } else {
          setTimeout(() => setMsg(null), 12000);
        }
      } catch (e) {
        setTone("err");
        setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  const color = tone === "err" ? "var(--danger)" : tone === "ok" ? "var(--brand)" : "var(--text-3)";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {msg && (
        <span style={{
          fontSize: 11.5, color, maxWidth: 480,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }} title={msg}>
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Icon name="sparkles" size={11} />
        {busy ? "Running…" : "Run demo setup"}
      </button>
    </div>
  );
}
