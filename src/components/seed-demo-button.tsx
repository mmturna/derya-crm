"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { setupDemoEnvironment, consolidateAshgabatSoybeanLoad } from "@/lib/setup-demo-actions";
import { seedDemoLoad } from "@/lib/seed-demo-load-action";

export function SeedDemoButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function runBoth() {
    if (!confirm("Set up demo state in this office?\n\n1. Consolidate every open soybean / SOURCING thread into one real load: Soybean meal — 300 MT to Ashgabat.\n2. Create a separate Black Sea Trading Co demo job (steel coils Constanta → Hamburg) with example documents.\n\nIdempotent — safe to re-run.")) return;
    setOpen(false);
    start(async () => {
      setMsg("Setting up…");
      const r = await setupDemoEnvironment();
      const lines: string[] = [];
      lines.push(r.soybean.ok ? `· Soybean: ${r.soybean.jobRef}${r.soybean.mergedCount ? ` (${r.soybean.mergedCount} merged)` : ""}` : `· Soybean: ${r.soybean.error}`);
      lines.push(r.steelDemo.ok ? `· Demo: ${r.steelDemo.jobRef} ${r.steelDemo.created ? "created" : "(already exists)"}` : `· Demo: ${r.steelDemo.error}`);
      setMsg(lines.join(" · "));
      router.refresh();
      setTimeout(() => setMsg(null), 8000);
    });
  }

  function consolidateOnly() {
    setOpen(false);
    start(async () => {
      setMsg("Consolidating soybean threads…");
      const r = await consolidateAshgabatSoybeanLoad();
      if ("error" in r) {
        setMsg(`Error: ${r.error}`);
        setTimeout(() => setMsg(null), 6000);
        return;
      }
      router.push(`/dashboard/jobs/${r.jobId}` as never);
    });
  }

  function seedOnly() {
    setOpen(false);
    start(async () => {
      setMsg("Seeding demo job…");
      const r = await seedDemoLoad();
      if ("error" in r) {
        setMsg(`Error: ${r.error}`);
        setTimeout(() => setMsg(null), 6000);
        return;
      }
      router.push(`/dashboard/jobs/${r.jobId}` as never);
    });
  }

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg}</span>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Icon name="sparkles" size={11} />
        {busy ? "Running…" : "Demo setup"}
        <Icon name="chevron-down" size={10} />
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 40 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", right: "0", top: "100%", marginTop: 4,
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
              minWidth: 320, padding: 6, zIndex: 60,
            }}
          >
            <DemoMenuItem
              title="Set up everything"
              subtitle="Consolidate soybean + create demo job. Recommended."
              onClick={runBoth}
              accent
            />
            <DemoMenuItem
              title="Consolidate soybean threads only"
              subtitle="Every open SOURCING thread → one Ashgabat 300 MT load."
              onClick={consolidateOnly}
            />
            <DemoMenuItem
              title="Create demo job only"
              subtitle="Black Sea Trading Co · steel coils Constanta → Hamburg, with PDFs."
              onClick={seedOnly}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DemoMenuItem({ title, subtitle, onClick, accent }: { title: string; subtitle: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "10px 12px", background: "transparent", border: "none",
        cursor: "pointer", borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: accent ? "var(--brand)" : "var(--text)" }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</div>
    </button>
  );
}
