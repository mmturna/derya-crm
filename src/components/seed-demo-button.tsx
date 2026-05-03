"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { seedDemoLoad } from "@/lib/seed-demo-load-action";

export function SeedDemoButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function go() {
    if (!confirm("Create the example demo load (Black Sea Trading Co — steel coils Constanta → Hamburg) in this office?\n\nIdempotent — if one already exists, this just re-opens it.")) return;
    start(async () => {
      setMsg(null);
      const r = await seedDemoLoad();
      if ("error" in r) {
        setMsg(r.error);
        setTimeout(() => setMsg(null), 6000);
        return;
      }
      router.push(`/dashboard/jobs/${r.jobId}` as never);
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11, color: "var(--danger)" }}>{msg}</span>}
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
        title="Create one fully-populated example load for demo purposes"
      >
        <Icon name="sparkles" size={11} />
        {busy ? "Seeding…" : "Demo load"}
      </button>
    </div>
  );
}
