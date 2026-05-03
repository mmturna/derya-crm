"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";

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

  // Customer
  let company = await prisma.company.findFirst({
    where: { officeId: args.officeId, name: "Black Sea Trading Co" },
    select: { id: true },
  });
  if (!company) {
    company = await prisma.company.create({
      data: {
        officeId: args.officeId,
        name: "Black Sea Trading Co",
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
      subject: "Steel coils — Constanta to Hamburg, 1x40HC",
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
      url: "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MK", // placeholder header — analysis is pre-set
      aiSummary: "Master Bill of Lading from MSC for the Constanta → Hamburg leg. Container MEDU2891744 listed, 40HC, 18,000 kg gross. Shipper Black Sea Trading Co, consignee Hamburg Cold Storage GmbH.",
      aiFlags: JSON.stringify(["Vessel ETD on BL (May 9) is one day later than the booked ETD — not blocking, but adjust customer comms if needed."]),
      aiKeyFields: JSON.stringify({ bl_number: "HAMB-2026-04781", vessel: "MSC ARIADNE", voyage: "21W", container_no: "MEDU2891744", gross_weight_kg: 18000, shipper: "Black Sea Trading Co", consignee: "Hamburg Cold Storage GmbH", port_of_loading: "Constanta", port_of_discharge: "Hamburg" }),
    },
    {
      name: "Commercial_Invoice_BST-2104.pdf",
      docType: "INVOICE",
      status: "APPROVED",
      url: "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MK",
      aiSummary: "Commercial invoice #BST-2104 for steel coils, total 18 MT × $1,150/MT = $20,700. Buyer Hamburg Cold Storage GmbH. Payment terms 30% TT advance + 70% LC at sight.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({ invoice_no: "BST-2104", invoice_date: "2026-05-01", currency: "USD", total: 20700, qty: 18, unit_price: 1150, payment_terms: "30% TT + 70% LC at sight", seller: "Black Sea Trading Co", buyer: "Hamburg Cold Storage GmbH" }),
    },
    {
      name: "Packing_List_BST-2104.pdf",
      docType: "PACKING_LIST",
      status: "UPLOADED",
      url: "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MK",
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
