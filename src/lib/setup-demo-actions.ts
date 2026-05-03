"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { mergeAllOpenInquiriesIntoOne } from "./merge-actions";
import { ensureProposedJobsForOpenInquiries, confirmProposedJob } from "./job-actions";
import { extractSourcingOffersForInquiry } from "./sourcing-offers";
import { seedDemoLoad } from "./seed-demo-load";

// Consolidate every open SOURCING-type inquiry in this office into ONE
// real (non-PROPOSED) Job titled the way the user expects: "Soybean meal —
// 300 MT to Ashgabat". After consolidation:
//  - Title/commodity/destination/weight set
//  - All linked email threads moved onto the keeper inquiry
//  - PROPOSED job upgraded to INQUIRY status (a real load on the kanban)
//  - Supplier offers re-extracted so the comparison table populates
//
// Uses mergeAllOpenInquiriesIntoOne(type=SOURCING, ...overrides) under the
// hood. Idempotent — running it twice on a single-inquiry office does nothing.
export async function consolidateAshgabatSoybeanLoad(): Promise<
  | { ok: true; jobId: string; reference: string; mergedCount: number }
  | { error: string }
> {
  const session = await requireSession();

  // Pre-pass: any SOURCING inquiry currently linked to a JOB whose status is
  // NOT a real load (i.e. PROPOSED, or no job at all) gets demoted so the
  // merge below can pick it up. Also un-confirms any PROPOSED job that
  // was set as "active" by accident — only the keeper should remain a real
  // load. We treat anything in INGESTED/PARSED/PRICED/QUOTED as fair game.
  const presentInquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      type: "SOURCING",
      status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
    },
    select: { id: true, job: { select: { id: true, status: true } } },
  });
  for (const inq of presentInquiries) {
    if (inq.job && inq.job.status !== "PROPOSED") {
      // Demote to PROPOSED so it can merge cleanly.
      await prisma.job.update({ where: { id: inq.job.id }, data: { status: "PROPOSED" } });
    }
  }

  // First, run the AI-driven merge with explicit specs.
  const merge = await mergeAllOpenInquiriesIntoOne({
    type: "SOURCING",
    subject: "Soybean meal — 300 MT to Ashgabat",
    commodity: "Soybean meal",
    destination: "Ashgabat, TM",
    weightKg: 300_000,
  });
  if ("error" in merge) {
    // Fall back: pick the existing single open SOURCING inquiry (if there is
    // exactly one) and just update its specs + confirm it.
    const candidates = await prisma.inquiry.findMany({
      where: {
        officeId: session.officeId,
        type: "SOURCING",
        status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
      },
      select: { id: true },
    });
    if (candidates.length === 0) {
      // Nothing to consolidate — bail with the original error.
      return { error: merge.error };
    }
    // If there's exactly one we can still upgrade it.
    if (candidates.length === 1) {
      const inq = candidates[0];
      await prisma.inquiry.update({
        where: { id: inq.id },
        data: {
          subject: "Soybean meal — 300 MT to Ashgabat",
          commodity: "Soybean meal",
          destination: "Ashgabat, TM",
          weight: 300_000,
        },
      });
      await ensureProposedJobsForOpenInquiries(session.officeId);
      const job = await prisma.job.findFirst({ where: { inquiryId: inq.id }, select: { id: true, reference: true, status: true } });
      if (!job) return { error: "Couldn't ensure a job for the soybean inquiry" };
      if (job.status === "PROPOSED") {
        await confirmProposedJob(job.id);
      }
      try { await extractSourcingOffersForInquiry(inq.id); } catch {}
      revalidatePath("/dashboard/jobs");
      revalidatePath("/dashboard/inbox");
      revalidatePath(`/dashboard/jobs/${job.id}`);
      return { ok: true, jobId: job.id, reference: job.reference, mergedCount: 0 };
    }
    return { error: merge.error };
  }

  // Promote the keeper from PROPOSED to INQUIRY so it shows as a real load.
  const keeperInquiryId = merge.keeperInquiryId;
  let keeperJobId = merge.keeperJobId;
  if (!keeperJobId) {
    await ensureProposedJobsForOpenInquiries(session.officeId);
    const j = await prisma.job.findFirst({ where: { inquiryId: keeperInquiryId }, select: { id: true } });
    keeperJobId = j?.id ?? null;
  }
  if (keeperJobId) {
    const status = await prisma.job.findUnique({ where: { id: keeperJobId }, select: { status: true } });
    if (status?.status === "PROPOSED") {
      await confirmProposedJob(keeperJobId);
    }
  }

  // Re-extract supplier offers so the comparison table is populated.
  try { await extractSourcingOffersForInquiry(keeperInquiryId); } catch {}

  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  if (keeperJobId) revalidatePath(`/dashboard/jobs/${keeperJobId}`);

  const finalJob = await prisma.job.findFirst({ where: { inquiryId: keeperInquiryId }, select: { id: true, reference: true } });
  return {
    ok: true,
    jobId: finalJob?.id ?? keeperJobId ?? "",
    reference: finalJob?.reference ?? "(unknown)",
    mergedCount: merge.mergedCount,
  };
}

// One-click setup that does both: consolidate soybean + seed steel-coils demo.
export async function setupDemoEnvironment(): Promise<{
  soybean: { ok: boolean; jobRef?: string; mergedCount?: number; error?: string };
  steelDemo: { ok: boolean; jobRef?: string; created?: boolean; error?: string };
}> {
  const session = await requireSession();

  const soybeanResult = await consolidateAshgabatSoybeanLoad();
  const seedResult = await seedDemoLoad({ officeId: session.officeId });

  return {
    soybean: "error" in soybeanResult
      ? { ok: false, error: soybeanResult.error }
      : { ok: true, jobRef: soybeanResult.reference, mergedCount: soybeanResult.mergedCount },
    steelDemo: "error" in seedResult
      ? { ok: false, error: seedResult.error }
      : { ok: true, jobRef: seedResult.reference, created: seedResult.created },
  };
}
