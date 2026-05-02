"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";

async function nextJobReference(officeId: string): Promise<string> {
  const count = await prisma.job.count({ where: { officeId } });
  return `JOB-${new Date().getFullYear()}-${String(count + 1).padStart(3, "0")}`;
}

// Create a PROPOSED-stage Job for an Inquiry that doesn't have one yet.
// Used by the auto-link flow so every freight-related thread shows up on the
// jobs board as a draft until the operator confirms it.
// IMPORTANT: caller must have already verified office ownership of the inquiry.
export async function createProposedJobForInquiry(inquiryId: string): Promise<string | null> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: { job: { select: { id: true } } },
  });
  if (!inquiry) return null;
  if (inquiry.job) return inquiry.job.id;

  const reference = await nextJobReference(inquiry.officeId);
  const job = await prisma.job.create({
    data: {
      officeId: inquiry.officeId,
      companyId: inquiry.companyId ?? null,
      inquiryId: inquiry.id,
      reference,
      status: "PROPOSED",
      type: inquiry.type,
      mode: inquiry.mode ?? null,
      origin: inquiry.origin ?? null,
      destination: inquiry.destination ?? null,
      commodity: inquiry.commodity ?? null,
      incoterms: inquiry.incoterms ?? null,
      weight: inquiry.weight ?? null,
      volume: inquiry.volume ?? null,
      currency: "USD",
    },
  });
  return job.id;
}

// Promote a PROPOSED job to a real INQUIRY-stage job (operator confirms it).
export async function confirmProposedJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { id: true, status: true, inquiryId: true },
  });
  if (!job) return { error: "Job not found" };
  if (job.status !== "PROPOSED") return { error: "Job is not in proposed stage" };

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "INQUIRY" },
  });
  if (job.inquiryId) {
    await prisma.inquiry.update({
      where: { id: job.inquiryId },
      data: { status: "PARSED" },
    });
  }
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true };
}

export async function discardProposedJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId, status: "PROPOSED" },
    select: { id: true, inquiryId: true },
  });
  if (!job) return { error: "Job not found or not proposed" };
  // Detach the inquiry's threads from the inquiry, then delete the job and inquiry stub.
  if (job.inquiryId) {
    await prisma.emailThread.updateMany({
      where: { inquiryId: job.inquiryId },
      data: { inquiryId: null, autoLinkedAt: null, autoLinkSkipReason: "Proposed job discarded" },
    });
  }
  await prisma.job.delete({ where: { id: jobId } });
  if (job.inquiryId) {
    await prisma.inquiry.delete({ where: { id: job.inquiryId } }).catch(() => {});
  }
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
