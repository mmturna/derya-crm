"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { ensureProposedJobsForOpenInquiries } from "./job-actions";

// AI-driven consolidation of duplicate Inquiries (and their PROPOSED jobs).
// Used when the inbox has many separate threads that all describe the same
// underlying deal — typical for SOURCING (one buyer, many supplier replies)
// where each supplier's first email creates its own thread and the AI hadn't
// linked them yet at the time.
//
// Strategy: load all open inquiries for the office, hand the list to Haiku,
// ask it to cluster them into "this is one deal" groups. For each cluster of
// 2+, keep the oldest inquiry, move all email threads from the others onto
// the keeper, and delete the duplicates (plus their PROPOSED jobs). Confirmed
// jobs (status != PROPOSED) are NEVER auto-merged.
export async function consolidateDuplicateInquiries(): Promise<
  | { ok: true; clusters: number; merged: number }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const inquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
    },
    select: {
      id: true, subject: true, type: true, fromEmail: true, fromCompany: true,
      commodity: true, origin: true, destination: true, mode: true,
      receivedAt: true, createdAt: true,
      job: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (inquiries.length < 2) return { ok: true, clusters: 0, merged: 0 };

  // Build candidate list for the AI.
  const lines = inquiries.map((i, idx) =>
    `[${idx}] id=${i.id} | ${i.type} | "${i.subject}" | from=${i.fromEmail ?? i.fromCompany ?? "?"} | commodity=${i.commodity ?? "—"} | route=${i.origin ?? "?"}→${i.destination ?? "?"} | mode=${i.mode ?? "—"} | created=${i.createdAt.toISOString().split("T")[0]}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: `You consolidate duplicate freight inquiries.

Input: a numbered list of open inquiries in one office. Many are duplicates of the same underlying deal (especially SOURCING — multiple supplier conversations for one buyer-commodity).

Output ONLY this JSON (no markdown):
{ "clusters": [
    { "ids": ["<inquiry-id>", "<inquiry-id>", ...], "reason": "<short — why these are one deal>" }
] }

Rules:
- Cluster TOGETHER inquiries that represent the SAME underlying deal. Strong signals: same commodity (loose match — "soybean" / "soybean meal" / "SBM" all match), same buyer/customer, overlapping origin or destination, similar subjects (Re:/Fwd: chains, common stem like "Animal Feed Grade Soybean Meal").
- Use the type as a tiebreaker: SOURCING duplicates are very common; FORWARDING duplicates are rarer.
- Only include clusters of size >= 2. Singletons go nowhere.
- Be aggressive about merging — duplicates are a bigger pain than over-merging. The operator can split later.
- If nothing clusters, return { "clusters": [] }.`,
    messages: [{
      role: "user",
      content: `OPEN INQUIRIES:\n\n${lines}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: { clusters?: { ids: string[]; reason: string }[] };
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }
  const clusters = parsed.clusters ?? [];

  let mergedCount = 0;
  let clusterCount = 0;
  const validIds = new Set(inquiries.map((i) => i.id));
  const inquiryById = new Map(inquiries.map((i) => [i.id, i]));

  for (const cluster of clusters) {
    const ids = (cluster.ids ?? []).filter((id) => validIds.has(id));
    if (ids.length < 2) continue;

    // Keeper = oldest by createdAt. Skip merging if any non-PROPOSED job is
    // attached to ANY inquiry in the cluster — those are confirmed and we
    // should not silently lose data. Merge only into the keeper if it's safe.
    const sorted = ids
      .map((id) => inquiryById.get(id)!)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = sorted[0];
    const losers = sorted.slice(1);

    const hasConfirmedJob = sorted.some((i) => i.job && i.job.status !== "PROPOSED");
    if (hasConfirmedJob) continue;

    clusterCount++;

    for (const loser of losers) {
      // Move email threads off the loser onto the keeper.
      await prisma.emailThread.updateMany({
        where: { inquiryId: loser.id },
        data: { inquiryId: keeper.id },
      });
      // Delete the loser's PROPOSED job (cascade is fine since job has only
      // soft refs — JobMilestone/JobDocument cascade delete via schema).
      if (loser.job?.id) {
        await prisma.job.delete({ where: { id: loser.job.id } }).catch(() => {});
      }
      // Delete the loser inquiry itself. Anything that referenced it
      // (email threads moved above; carrier quotes — drop them since this is
      // an unconfirmed dup).
      await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.id } }).catch(() => {});
      await prisma.inquiry.delete({ where: { id: loser.id } }).catch(() => {});
      mergedCount++;
    }

    // Append a merge note to the keeper for traceability.
    const noteAppend = `\n\n[Auto-merged ${losers.length} duplicate inquir${losers.length === 1 ? "y" : "ies"} on ${new Date().toISOString().split("T")[0]}: ${cluster.reason ?? "AI-detected duplicate"}]`;
    await prisma.$executeRaw`UPDATE "Inquiry" SET "notes" = COALESCE("notes", '') || ${noteAppend} WHERE "id" = ${keeper.id}`;
  }

  // After merging, backfill PROPOSED jobs for keepers that lost theirs.
  await ensureProposedJobsForOpenInquiries(session.officeId);

  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return { ok: true, clusters: clusterCount, merged: mergedCount };
}

// Operator-directed: consolidate ALL open inquiries (optionally filtered by
// type) into ONE big procurement/forwarding job. Used when the user has a
// bunch of related-but-not-identical RFQs (soybean meal, corn gluten,
// cottonseed cake, fish meal — all animal feed sourcing for one buyer) and
// wants to manage them as a single job rather than N separate ones.
//
// Strategy: keep the inquiry with the most attached email threads (richest
// context), move every other inquiry's threads onto it, regenerate the
// subject + commodity using AI, delete sibling inquiries + their PROPOSED
// jobs. CONFIRMED jobs are NEVER auto-merged.
export async function mergeAllOpenInquiriesIntoOne(args: {
  type?: "SOURCING" | "FORWARDING";
} = {}): Promise<
  | { ok: true; mergedCount: number; keeperInquiryId: string; keeperJobId: string | null; subject: string }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const where: {
    officeId: string;
    status: { in: string[] };
    type?: string;
    job: { is: { status: string } } | null;
  } = {
    officeId: session.officeId,
    status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
    // Only consider inquiries whose linked job is still PROPOSED (or has no
    // job yet). Confirmed jobs are real work and shouldn't be merged.
    job: null,
  };
  if (args.type) where.type = args.type;

  // Find all candidates (job is null OR job.status = PROPOSED).
  const candidates = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
      ...(args.type ? { type: args.type } : {}),
      OR: [
        { job: null },
        { job: { is: { status: "PROPOSED" } } },
      ],
    },
    include: {
      _count: { select: { emailThreads: true } },
      job: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length < 2) return { error: "Need at least 2 mergeable inquiries — none or only one open." };

  // Keeper = the one with the most attached email threads (richest context).
  // Tiebreak by oldest.
  candidates.sort((a, b) => {
    if (b._count.emailThreads !== a._count.emailThreads) return b._count.emailThreads - a._count.emailThreads;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const keeper = candidates[0];
  const losers = candidates.slice(1);

  // AI generates a new subject + commodity that summarizes the consolidated deal.
  const summaryInput = candidates.map((c) =>
    `- "${c.subject}" | commodity: ${c.commodity ?? "—"} | from: ${c.fromEmail ?? c.fromCompany ?? "—"} | route: ${c.origin ?? "?"} → ${c.destination ?? "?"}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: `You write a single concise subject line for a consolidated procurement/forwarding job that merges multiple related RFQs.

Output ONLY this JSON (no markdown):
{ "subject": string, "commodity": string }

The subject should be short (under 80 chars) and describe the umbrella deal — e.g. "Animal feed procurement (soybean meal, corn gluten, cottonseed cake, fish meal)" or "Multi-port European delivery — Q3 2026".
The commodity field should be a comma-separated list of the underlying commodities or a generic category if they all fit one.`,
    messages: [{
      role: "user",
      content: `Consolidating these ${candidates.length} inquiries into one ${args.type ?? "open"} job:\n\n${summaryInput}`,
    }],
  });
  const txt = result.content[0].type === "text" ? result.content[0].text : "";
  const m = txt.match(/\{[\s\S]*\}/);
  let newSubject = keeper.subject;
  let newCommodity = keeper.commodity;
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (typeof j.subject === "string" && j.subject.trim()) newSubject = j.subject.trim().slice(0, 200);
      if (typeof j.commodity === "string" && j.commodity.trim()) newCommodity = j.commodity.trim().slice(0, 200);
    } catch { /* keep keeper's */ }
  }

  // Move every loser's threads onto the keeper, then delete the loser.
  for (const loser of losers) {
    await prisma.emailThread.updateMany({
      where: { inquiryId: loser.id },
      data: { inquiryId: keeper.id },
    });
    if (loser.job?.id) {
      await prisma.job.delete({ where: { id: loser.job.id } }).catch(() => {});
    }
    await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.id } }).catch(() => {});
    await prisma.inquiry.delete({ where: { id: loser.id } }).catch(() => {});
  }

  // Update the keeper with the merged subject + commodity, and append an audit note.
  const auditNote = `\n\n[Auto-consolidated ${losers.length} inquiries on ${new Date().toISOString().split("T")[0]}: ${losers.map((l) => `"${l.subject}"`).join(", ")}]`;
  await prisma.inquiry.update({
    where: { id: keeper.id },
    data: {
      subject: newSubject,
      commodity: newCommodity,
    },
  });
  await prisma.$executeRaw`UPDATE "Inquiry" SET "notes" = COALESCE("notes", '') || ${auditNote} WHERE "id" = ${keeper.id}`;

  // Backfill or fetch the keeper's PROPOSED job, and propagate the new subject/commodity.
  await ensureProposedJobsForOpenInquiries(session.officeId);
  const keeperJob = await prisma.job.findFirst({
    where: { inquiryId: keeper.id },
    select: { id: true, commodity: true },
  });
  if (keeperJob && (keeperJob.commodity == null || keeperJob.commodity === "")) {
    await prisma.job.update({
      where: { id: keeperJob.id },
      data: { commodity: newCommodity },
    });
  }

  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return {
    ok: true,
    mergedCount: losers.length,
    keeperInquiryId: keeper.id,
    keeperJobId: keeperJob?.id ?? null,
    subject: newSubject,
  };
}
