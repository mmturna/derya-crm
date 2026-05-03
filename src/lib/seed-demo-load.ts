"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";

// Build a minimal one-page PDF with the given title and body lines, returned
// as a data: URL. Used to seed demo documents that the inline viewer can
// render and the PDF text extractor can read. Pure ASCII, no fonts embedded —
// uses the standard Helvetica that every PDF reader has built in.
function makeDemoPdfDataUrl(title: string, lines: string[]): string {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const safeTitle = escape(title);
  const safeLines = lines.map(escape);

  // Build the content stream. Position starts near the top of an A4 page.
  let content = "BT\n/F1 16 Tf\n72 760 Td\n(" + safeTitle + ") Tj\nET\n";
  let y = 720;
  for (const ln of safeLines) {
    content += `BT\n/F1 11 Tf\n72 ${y} Td\n(${ln}) Tj\nET\n`;
    y -= 18;
  }

  const objs: string[] = [];
  // 1: Catalog
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // 3: Page
  objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  // 4: Content stream
  const contentLen = Buffer.byteLength(content, "latin1");
  objs.push(`<< /Length ${contentLen} >>\nstream\n${content}endstream`);
  // 5: Font
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + (objs.length + 1) + "\n";
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += String(off).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const b64 = Buffer.from(pdf, "latin1").toString("base64");
  return `data:application/pdf;base64,${b64}`;
}

// Seed one fully-populated FORWARDING job for demo purposes:
// - Customer (creates one named "Black Sea Trading Co" if missing)
// - Inquiry with parsed shipment fields
// - Job with revenue/cost/margin set, status BOOKED
// - 3 carrier rates received, one selected
// - Milestones: BOOKING confirmed, ETD planned, ETA planned, others pending
// - 3 documents (BL, INVOICE, PACKING_LIST) with placeholder data: URLs and
//   pre-baked AI analysis so the workbench shows "AI commented" right away
// - Portal token populated
//
// Idempotent — returns the existing demo job if one already exists.
export async function seedDemoLoad(args: { officeId: string }): Promise<{ ok: true; jobId: string; reference: string; created: boolean } | { error: string }> {
  // Check if a previous seed exists.
  const existing = await prisma.job.findFirst({
    where: { officeId: args.officeId, notes: { contains: "[DEMO_LOAD_SEED]" } },
    select: { id: true, reference: true },
  });
  if (existing) return { ok: true, jobId: existing.id, reference: existing.reference, created: false };

  // Customer — name starts with "DEMO" so it's visually obvious this is a
  // staged record vs the operator's real customers.
  const demoCompanyName = "DEMO · Black Sea Trading Co";
  let company = await prisma.company.findFirst({
    where: { officeId: args.officeId, name: demoCompanyName },
    select: { id: true },
  });
  if (!company) {
    company = await prisma.company.create({
      data: {
        officeId: args.officeId,
        name: demoCompanyName,
        status: "WORKED",
        class1: "Active",
        class2: "B",
        product: "Sea",
        lane: "Mediterranean",
        direction: "Export",
      },
      select: { id: true },
    });
  }

  // Inquiry (the source RFQ)
  const inquiry = await prisma.inquiry.create({
    data: {
      officeId: args.officeId,
      companyId: company.id,
      subject: "DEMO · Steel coils — Constanta to Hamburg, 1x40HC",
      fromEmail: "ops@blackseatrading.example",
      fromCompany: "Black Sea Trading Co",
      type: "FORWARDING",
      status: "QUOTED",
      origin: "Constanta, RO",
      destination: "Hamburg, DE",
      mode: "SEA-FCL",
      containerType: "40HC",
      incoterms: "FOB",
      commodity: "Cold-rolled steel coils, 18 MT",
      weight: 18000,
      volume: 28,
      cargoReadyDate: new Date(Date.now() + 4 * 86400000),
      receivedAt: new Date(Date.now() - 6 * 86400000),
      notes: "Customer is repeat shipper — 4 prior loads on this lane.",
      rawEmailBody: "[Demo seed] Original RFQ from Black Sea Trading Co requesting rate Constanta → Hamburg, 1x40HC steel coils.",
    },
  });

  // Job — set up like a mid-pipeline shipment
  const count = await prisma.job.count({ where: { officeId: args.officeId } });
  const reference = `JOB-${new Date().getFullYear()}-${String(count + 1).padStart(3, "0")}`;
  const portalToken = crypto.randomBytes(16).toString("hex");
  const etd = new Date(Date.now() + 6 * 86400000);
  const eta = new Date(Date.now() + 16 * 86400000);

  const job = await prisma.job.create({
    data: {
      officeId: args.officeId,
      companyId: company.id,
      inquiryId: inquiry.id,
      reference,
      status: "BOOKED",
      type: "FORWARDING",
      mode: "SEA-FCL",
      origin: "Constanta, RO",
      destination: "Hamburg, DE",
      commodity: "Cold-rolled steel coils, 18 MT",
      incoterms: "FOB",
      weight: 18000,
      volume: 28,
      packages: 12,
      etd,
      eta,
      revenue: 4250,
      cost: 3120,
      currency: "USD",
      portalToken,
      notifyCustomer: true,
      customerEmail: "ops@blackseatrading.example",
      notes: "Refrigerated trailer to port — operator handed off to carrier on day 2. [DEMO_LOAD_SEED]",
    },
  });

  // 3 carrier rates received, one selected
  await prisma.carrierQuote.createMany({
    data: [
      { inquiryId: inquiry.id, carrier: "MSC",   service: "Constanta-Hamburg Express", total40HC: 3120, transitDays: 11, validity: "30 days", status: "RECEIVED" },
      { inquiryId: inquiry.id, carrier: "Maersk", service: "Adriatic Med",              total40HC: 3380, transitDays: 12, validity: "21 days", status: "RECEIVED" },
      { inquiryId: inquiry.id, carrier: "CMA CGM", service: "Med Direct",               total40HC: 3290, transitDays: 13, validity: "14 days", status: "RECEIVED" },
    ],
  });

  // Milestones
  const ms = [
    { type: "BOOKING",          plannedAt: new Date(Date.now() - 2 * 86400000), actualAt: new Date(Date.now() - 1 * 86400000) },
    { type: "CARGO_READY",      plannedAt: new Date(Date.now() + 4 * 86400000), actualAt: null },
    { type: "ETD",              plannedAt: etd, actualAt: null },
    { type: "ETA",              plannedAt: eta, actualAt: null },
    { type: "CUSTOMS_ENTRY",    plannedAt: new Date(eta.getTime() + 86400000), actualAt: null },
    { type: "CUSTOMS_RELEASE",  plannedAt: new Date(eta.getTime() + 2 * 86400000), actualAt: null },
    { type: "DELIVERY",         plannedAt: new Date(eta.getTime() + 3 * 86400000), actualAt: null },
  ];
  for (const m of ms) {
    await prisma.jobMilestone.create({ data: { jobId: job.id, type: m.type, plannedAt: m.plannedAt, actualAt: m.actualAt ?? undefined } });
  }

  // Documents — 3 demo PDFs with pre-baked AI analysis (so the workbench
  // shows "AI commented" without needing real PDF bytes).
  const docs = [
    {
      name: "BL_HAMB-2026-04781.pdf",
      docType: "BL",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("BL — HAMB-2026-04781", [
        "BILL OF LADING (Master)",
        "BL Number: HAMB-2026-04781",
        "Vessel: MSC ARIADNE   Voyage: 21W",
        "Container: MEDU2891744 (40HC)",
        "Gross weight: 18,000 kg   Packages: 12 wooden crates",
        "Shipper: Black Sea Trading Co (Constanta, RO)",
        "Consignee: Hamburg Cold Storage GmbH (Hamburg, DE)",
        "Port of loading: Constanta   Port of discharge: Hamburg",
        "Vessel ETD: 09 May 2026   ETA: 20 May 2026",
        "Freight: prepaid   Carrier: MSC",
      ]),
      aiSummary: "Master Bill of Lading from MSC for the Constanta → Hamburg leg. Container MEDU2891744 listed, 40HC, 18,000 kg gross. Shipper Black Sea Trading Co, consignee Hamburg Cold Storage GmbH.",
      aiFlags: JSON.stringify(["Vessel ETD on BL (May 9) is one day later than the booked ETD — not blocking, but adjust customer comms if needed."]),
      aiKeyFields: JSON.stringify({ bl_number: "HAMB-2026-04781", vessel: "MSC ARIADNE", voyage: "21W", container_no: "MEDU2891744", gross_weight_kg: 18000, shipper: "Black Sea Trading Co", consignee: "Hamburg Cold Storage GmbH", port_of_loading: "Constanta", port_of_discharge: "Hamburg" }),
    },
    {
      name: "Commercial_Invoice_BST-2104.pdf",
      docType: "INVOICE",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Commercial Invoice — BST-2104", [
        "COMMERCIAL INVOICE",
        "Invoice No: BST-2104   Date: 01 May 2026",
        "Seller: Black Sea Trading Co — Constanta, RO",
        "Buyer:  Hamburg Cold Storage GmbH — Hamburg, DE",
        "Item: Cold-rolled steel coils",
        "Quantity: 18 MT × USD 1,150 / MT = USD 20,700",
        "Currency: USD   Incoterms: FOB Constanta",
        "Payment terms: 30% TT advance + 70% LC at sight",
        "Buyer reference: HCS-PO-2026-91",
      ]),
      aiSummary: "Commercial invoice #BST-2104 for steel coils, total 18 MT × $1,150/MT = $20,700. Buyer Hamburg Cold Storage GmbH. Payment terms 30% TT advance + 70% LC at sight.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({ invoice_no: "BST-2104", invoice_date: "2026-05-01", currency: "USD", total: 20700, qty: 18, unit_price: 1150, payment_terms: "30% TT + 70% LC at sight", seller: "Black Sea Trading Co", buyer: "Hamburg Cold Storage GmbH" }),
    },
    {
      name: "Packing_List_BST-2104.pdf",
      docType: "PACKING_LIST",
      status: "UPLOADED",
      url: makeDemoPdfDataUrl("Packing List — BST-2104", [
        "PACKING LIST",
        "Reference: BST-2104",
        "Total packages: 12 wooden crates",
        "Gross weight: 18,200 kg",
        "Net weight: 18,000 kg",
        "Crate dimensions (avg): 120 × 80 × 60 cm",
        "Marks & numbers: BST/HCS/2026/01-12",
        "Container: MEDU2891744 (40HC)",
      ]),
      aiSummary: "Packing list for invoice BST-2104. 12 wooden crates, gross 18,200 kg, net 18,000 kg. Crate dimensions averaging 120×80×60 cm.",
      aiFlags: JSON.stringify(["Net weight (18,000 kg) matches the invoice but gross (18,200 kg) is 200 kg above what the BL records — confirm with shipper before customs entry."]),
      aiKeyFields: JSON.stringify({ total_packages: 12, gross_weight_kg: 18200, net_weight_kg: 18000, dimensions: "120×80×60 cm avg", package_type: "Wooden crate" }),
    },
    { name: "Certificate of Origin (pending)", docType: "COO", status: "PENDING", url: null, aiSummary: null, aiFlags: null, aiKeyFields: null },
    { name: "Customs declaration (pending)",   docType: "CUSTOMS", status: "PENDING", url: null, aiSummary: null, aiFlags: null, aiKeyFields: null },
  ];
  for (const d of docs) {
    await prisma.jobDocument.create({
      data: {
        jobId: job.id,
        officeId: args.officeId,
        name: d.name,
        url: d.url,
        docType: d.docType,
        status: d.status,
        aiSummary: d.aiSummary,
        aiFlags: d.aiFlags,
        aiKeyFields: d.aiKeyFields,
        aiAnalyzedAt: d.aiSummary ? new Date() : null,
      },
    });
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${job.id}`);
  revalidatePath(`/dashboard/rfq/${inquiry.id}`);

  return { ok: true, jobId: job.id, reference, created: true };
}
