import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function createRFQ(formData: FormData) {
  "use server";
  const session = await requireSession();

  const companyId = String(formData.get("companyId") || "");
  const cargoReadyDate = formData.get("cargoReadyDate")
    ? new Date(String(formData.get("cargoReadyDate")))
    : null;

  const inquiry = await prisma.inquiry.create({
    data: {
      officeId:      session.officeId,
      companyId:     companyId || null,
      subject:       String(formData.get("subject") || "Manual RFQ"),
      fromEmail:     String(formData.get("fromEmail") || ""),
      fromCompany:   String(formData.get("fromCompany") || ""),
      status:        "PARSED",
      origin:        String(formData.get("origin") || ""),
      destination:   String(formData.get("destination") || ""),
      mode:          String(formData.get("mode") || ""),
      containerType: String(formData.get("containerType") || ""),
      incoterms:     String(formData.get("incoterms") || ""),
      commodity:     String(formData.get("commodity") || ""),
      weight:        formData.get("weight") ? Number(formData.get("weight")) : null,
      volume:        formData.get("volume") ? Number(formData.get("volume")) : null,
      notes:         String(formData.get("notes") || ""),
      rawEmailBody:  String(formData.get("notes") || ""),
      cargoReadyDate,
      receivedAt:    new Date(),
    },
  });

  revalidatePath("/dashboard/rfq");
  redirect(`/dashboard/rfq/${inquiry.id}`);
}

export default async function NewRFQPage() {
  const session = await requireSession();

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard/rfq" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          RFQ Inbox
        </a>
      </div>

      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Manual RFQ Entry</h1>
          <p className="page-subtitle">Add a freight request received by phone, chat, or other channel</p>
        </div>
      </div>

      <form action={createRFQ}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 16 }}>Request Info</div>
            <label className="field" style={{ marginBottom: 12 }}>
              <span>Subject / Description <span style={{ color: "var(--danger)" }}>*</span></span>
              <input name="subject" required placeholder="e.g. FCL Quote Request – Shanghai to Hamburg" />
            </label>
            <div className="form-grid-2" style={{ marginBottom: 12 }}>
              <label className="field"><span>From (email)</span>
                <input name="fromEmail" type="email" placeholder="customer@example.com" />
              </label>
              <label className="field"><span>From (company)</span>
                <input name="fromCompany" placeholder="Company name" />
              </label>
            </div>
            <label className="field">
              <span>Link to Customer</span>
              <select name="companyId">
                <option value="">— Select (optional) —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 16 }}>Freight Details</div>
            <div className="form-grid-2" style={{ marginBottom: 12 }}>
              <label className="field"><span>Origin</span>
                <input name="origin" placeholder="e.g. Shanghai, CN" />
              </label>
              <label className="field"><span>Destination</span>
                <input name="destination" placeholder="e.g. Hamburg, DE" />
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
              <label className="field"><span>Container</span>
                <select name="containerType">
                  <option value="">— Select —</option>
                  <option value="20GP">20GP</option>
                  <option value="40GP">40GP</option>
                  <option value="40HC">40HC</option>
                  <option value="LCL">LCL</option>
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
            </div>
            <div className="form-grid-3" style={{ marginBottom: 12 }}>
              <label className="field"><span>Commodity</span>
                <input name="commodity" placeholder="e.g. Machinery" />
              </label>
              <label className="field"><span>Weight (kg)</span>
                <input name="weight" type="number" placeholder="0" />
              </label>
              <label className="field"><span>Volume (cbm)</span>
                <input name="volume" type="number" placeholder="0" />
              </label>
            </div>
            <label className="field">
              <span>Cargo Ready Date</span>
              <input name="cargoReadyDate" type="date" />
            </label>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-body">
            <div className="section-title" style={{ marginBottom: 12 }}>Notes</div>
            <label className="field">
              <span>Additional notes or requirements</span>
              <textarea name="notes" rows={4} placeholder="Hazmat, temperature control, special handling…" />
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" type="submit">Create RFQ</button>
          <a href="/dashboard/rfq" className="btn btn-secondary" style={{ textDecoration: "none" }}>Cancel</a>
        </div>
      </form>
    </div>
  );
}
