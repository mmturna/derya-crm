"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobAllFields, updateJobStatus } from "@/app/dashboard/jobs/[jobId]/actions";

type JobShape = {
  id: string;
  reference: string;
  status: string;
  companyId: string | null;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  incoterms: string | null;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  etd: Date | null;
  eta: Date | null;
  revenue: number | null;
  cost: number | null;
  currency: string | null;
};

type CompanyOption = { id: string; name: string };

const STATUS_OPTIONS = [
  ["INQUIRY", "Inquiry"], ["QUOTED", "Quoted"], ["BOOKED", "Booked"],
  ["IN_TRANSIT", "In Transit"], ["CUSTOMS", "Customs"], ["DELIVERED", "Delivered"], ["CANCELLED", "Cancelled"],
];

function fmtDateInput(d: Date | null) {
  return d ? new Date(d).toISOString().split("T")[0] : "";
}

export function JobEditPanel({ job, companies }: { job: JobShape; companies: CompanyOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(formData: FormData) {
    startTransition(async () => {
      await updateJobAllFields(job.id, formData);
      setOpen(false);
      router.refresh();
    });
  }

  function quickStatus(s: string) {
    startTransition(async () => {
      await updateJobStatus(job.id, s);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5 }}
        title="Edit shipment details"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Edit
      </button>

      {open && (
        <div className="edit-panel-backdrop" onClick={() => setOpen(false)}>
          <aside className="edit-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit shipment">
            <header className="edit-panel-header">
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  Edit shipment
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, fontFamily: "ui-monospace, Menlo, monospace" }}>{job.reference}</div>
              </div>
              <button onClick={() => setOpen(false)} className="edit-panel-close" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </header>

            {/* Quick status changer at the top */}
            <div className="edit-panel-section">
              <div className="edit-panel-section-title">Move to stage</div>
              <div className="status-quickpick">
                {STATUS_OPTIONS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || job.status === key}
                    onClick={() => quickStatus(key)}
                    className={`status-quick ${job.status === key ? "active" : ""}`}
                  >{label}</button>
                ))}
              </div>
            </div>

            <form ref={formRef} action={submit} className="edit-panel-form">
              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Customer</div>
                <select name="companyId" defaultValue={job.companyId ?? ""}>
                  <option value="">— No customer —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Route</div>
                <div className="form-grid-2">
                  <label className="field">
                    <span>Origin</span>
                    <input name="origin" defaultValue={job.origin ?? ""} placeholder="e.g. Istanbul, TR" />
                  </label>
                  <label className="field">
                    <span>Destination</span>
                    <input name="destination" defaultValue={job.destination ?? ""} placeholder="e.g. Munich, DE" />
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Cargo</div>
                <div className="form-grid-3">
                  <label className="field">
                    <span>Mode</span>
                    <select name="mode" defaultValue={job.mode ?? ""}>
                      <option value="">—</option>
                      <option value="SEA-FCL">Sea FCL</option>
                      <option value="SEA-LCL">Sea LCL</option>
                      <option value="AIR">Air</option>
                      <option value="ROAD">Road</option>
                      <option value="COURIER">Courier</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Incoterms</span>
                    <select name="incoterms" defaultValue={job.incoterms ?? ""}>
                      <option value="">—</option>
                      {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Currency</span>
                    <select name="currency" defaultValue={job.currency ?? "USD"}>
                      <option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option>
                    </select>
                  </label>
                </div>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Commodity</span>
                  <input name="commodity" defaultValue={job.commodity ?? ""} placeholder="e.g. Machine parts" />
                </label>
                <div className="form-grid-3" style={{ marginTop: 10 }}>
                  <label className="field"><span>Weight (kg)</span>
                    <input name="weight" type="number" defaultValue={job.weight ?? ""} />
                  </label>
                  <label className="field"><span>Volume (cbm)</span>
                    <input name="volume" type="number" defaultValue={job.volume ?? ""} />
                  </label>
                  <label className="field"><span>Packages</span>
                    <input name="packages" type="number" defaultValue={job.packages ?? ""} />
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Dates</div>
                <div className="form-grid-2">
                  <label className="field">
                    <span>ETD (departure)</span>
                    <input name="etd" type="date" defaultValue={fmtDateInput(job.etd)} />
                  </label>
                  <label className="field">
                    <span>ETA (arrival)</span>
                    <input name="eta" type="date" defaultValue={fmtDateInput(job.eta)} />
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Financials</div>
                <div className="form-grid-2">
                  <label className="field"><span>Revenue</span>
                    <input name="revenue" type="number" defaultValue={job.revenue ?? ""} />
                  </label>
                  <label className="field"><span>Cost</span>
                    <input name="cost" type="number" defaultValue={job.cost ?? ""} />
                  </label>
                </div>
              </div>

              {/* Hidden status field so updateJobAllFields gets it */}
              <input type="hidden" name="status" value={job.status} />

              <div className="edit-panel-footer">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
