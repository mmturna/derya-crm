"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markMilestoneActual, updateMilestonePlanned } from "@/app/dashboard/jobs/[jobId]/actions";

export function MilestoneEdit({
  milestoneId,
  plannedAt,
}: {
  milestoneId: string;
  plannedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(plannedAt ?? "");
  const [busy, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function setPlanned() {
    if (!date) return;
    startTransition(async () => {
      await updateMilestonePlanned(milestoneId, date);
      setOpen(false);
      router.refresh();
    });
  }

  function markDone() {
    startTransition(async () => {
      await markMilestoneActual(milestoneId);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={ref} style={{ position: "relative", marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 10, padding: "2px 6px" }}
      >
        {open ? "Close" : "Edit"}
      </button>
      {open && (
        <div className="ms-edit-pop">
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ fontSize: 10.5, padding: "2px 4px", width: 120 }}
            />
            <button
              onClick={setPlanned}
              disabled={busy || !date}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 10, padding: "2px 5px" }}
            >Set</button>
          </div>
          <button
            onClick={markDone}
            disabled={busy}
            className="btn btn-sm"
            style={{ fontSize: 10, padding: "2px 6px", width: "100%", marginTop: 6 }}
          >Mark done now</button>
        </div>
      )}
    </div>
  );
}
