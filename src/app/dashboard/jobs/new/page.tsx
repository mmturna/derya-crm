import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function createJob(formData: FormData) {
  "use server";
  const session = await requireSession();

  const count = await prisma.job.count({ where: { officeId: session.officeId } });
  const reference = `JOB-${new Date().getFullYear()}-${String(count + 1).padStart(3, "0")}`;

  const companyId = String(formData.get("companyId") || "");
  const etd = formData.get("etd") ? new Date(String(formData.get("etd"))) : null;
  const eta = formData.get("eta") ? new Date(String(formData.get("eta"))) : null;

  const job = await prisma.job.create({
    data: {
      officeId:    session.officeId,
      companyId:   companyId || null,
      reference,
      status:      "INQUIRY",
      mode:        String(formData.get("mode") || ""),
      origin:      String(formData.get("origin") || ""),
      destination: String(formData.get("destination") || ""),
      commodity:   String(formData.get("commodity") || ""),
      incoterms:   String(formData.get("incoterms") || ""),
      weight:      formData.get("weight") ? Number(formData.get("weight")) : null,
      volume:      formData.get("volume") ? Number(formData.get("volume")) : null,
      revenue:     formData.get("revenue") ? Number(formData.get("revenue")) : null,
      cost:        formData.get("cost") ? Number(formData.get("cost")) : null,
      currency:    "USD",
      etd,
      eta,
      assignedToUserId: session.userId,
    },
  });

  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${job.id}`);
}

export default async function NewJobPage() {
  const session = await requireSession();

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard/jobs" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Jobs
        </a>
      </div>

      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">New Job</h1>
          <p className="page-subtitle">Create a manual job without an RFQ</p>
        </div>
      </div>

      <form action={createJob}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 16 }}>Customer</div>
            <label className="field">
              <span>Customer</span>
              <select name="companyId">
                <option value="">— Select customer (optional) —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 16 }}>Route & Cargo</div>
            <div className="form-grid-2" style={{ marginBottom: 12 }}>
              <label className="field"><span>Origin <span style={{ color: "var(--danger)" }}>*</span></span>
                <input name="origin" required placeholder="e.g. Shanghai, CN" />
              </label>
              <label className="field"><span>Destination <span style={{ color: "var(--danger)" }}>*</span></span>
                <input name="destination" required placeholder="e.g. Hamburg, DE" />
              </label>
            </div>
            <div className="form-grid-3" style={{ marginBottom: 12 }}>
              <label className="field"><span>Mode</span>
                <select name="mode">
                  <option value="">— Select —</option>
                  <option value="SEA-FCL">Sea FCL</option>
                  <option value="SEA-LCL">Sea LCL</option>
                  <option value="AIR">Air</option>
                  <option value="ROAD">Road</option>
                  <option value="COURIER">Courier</option>
                </select>
              </label>
              <label className="field"><span>Incoterms</span>
                <select name="incoterms">
                  <option value="">— Select —</option>
                  {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field"><span>Commodity</span>
                <input name="commodity" placeholder="e.g. Electronics" />
              </label>
            </div>
            <div className="form-grid-2" style={{ marginBottom: 0 }}>
              <label className="field"><span>Weight (kg)</span>
                <input name="weight" type="number" placeholder="0" />
              </label>
              <label className="field"><span>Volume (cbm)</span>
                <input name="volume" type="number" placeholder="0" />
              </label>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 16 }}>Dates</div>
            <div className="form-grid-2">
              <label className="field"><span>ETD (Est. Departure)</span>
                <input name="etd" type="date" />
              </label>
              <label className="field"><span>ETA (Est. Arrival)</span>
                <input name="eta" type="date" />
              </label>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 16 }}>Financials (optional)</div>
            <div className="form-grid-2">
              <label className="field"><span>Revenue (USD)</span>
                <input name="revenue" type="number" placeholder="0" />
              </label>
              <label className="field"><span>Cost (USD)</span>
                <input name="cost" type="number" placeholder="0" />
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" type="submit">Create Job</button>
          <a href="/dashboard/jobs" className="btn btn-secondary" style={{ textDecoration: "none" }}>Cancel</a>
        </div>
      </form>
    </div>
  );
}
