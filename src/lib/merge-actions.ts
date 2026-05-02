"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";

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

  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return { ok: true, clusters: clusterCount, merged: mergedCount };
}
