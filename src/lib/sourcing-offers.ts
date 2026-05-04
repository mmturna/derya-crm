"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";

export type SupplierOffer = {
  supplierName: string | null;
  pricePerUnit: number | null;
  currency: string | null;
  unit: string | null;            // "MT", "kg", "container", "lb"
  qtyAvailable: string | null;    // free-form: "2 containers", "50 MT/month"
  incoterms: string | null;
  paymentTerms: string | null;    // "30% TT advance, 70% LC at sight", etc
  origin: string | null;          // supplier's country/port
  leadTime: string | null;        // "2-3 weeks"
  validity: string | null;        // "valid until 30 May 2026"
  sampleAvailable: boolean | null;
  notes: string | null;           // anything else worth keeping
  hasNoOffer: boolean;            // true if AI couldn't find any offer-shaped content
};

// Walk all linked threads of a SOURCING inquiry and re-extract supplier offers.
// Persists each thread's offer JSON onto the EmailThread row. Idempotent.
export async function extractSourcingOffersForInquiry(
  inquiryId: string
): Promise<{ ok: true; threads: number; extracted: number } | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: {
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
    },
  });
  if (!inquiry) return { error: "Inquiry not found" };

  const client = new Anthropic({ apiKey });
  let extracted = 0;

  // Skip threads that already have a recent extraction (saves the round-trip).
  const STALE_AFTER_MS = 7 * 24 * 3600 * 1000;
  const candidates = inquiry.emailThreads.filter((t) => {
    if (t.messages.length === 0) return false;
    if (t.supplierOfferAt && Date.now() - t.supplierOfferAt.getTime() < STALE_AFTER_MS) return false;
    return true;
  });

  // Process in parallel batches so 60+ threads don't hit a function timeout.
  // Batch size of 10 = ~6s for 60 threads instead of 60s.
  const BATCH = 10;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    await Promise.all(slice.map(async (thread) => {
      try {
        const transcript = thread.messages.map((m) => {
          const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
          return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\n${m.bodyText ?? ""}`.trim();
        }).join("\n\n────\n\n").slice(0, 12000);

        const result = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: `You analyze a single email thread between our office and ONE supplier (or one party). Extract the supplier's offer terms for the commodity "${inquiry.commodity ?? "(unknown)"}".

Output ONLY this JSON (no markdown):
{
  "supplierName": string | null,           // company name from signature, "From:" or letterhead
  "pricePerUnit": number | null,           // numeric — e.g. 480 (not "480 USD/MT")
  "currency": string | null,               // "USD", "EUR", "TRY"...
  "unit": string | null,                   // "MT", "kg", "container", "lb"
  "qtyAvailable": string | null,           // e.g. "2 containers/month", "100 MT"
  "incoterms": string | null,              // "FOB", "CIF Constanta", "EXW"...
  "paymentTerms": string | null,           // "30% TT advance + 70% LC", "100% LC at sight"
  "origin": string | null,                 // supplier's country / port
  "leadTime": string | null,               // "2-3 weeks", "ready"
  "validity": string | null,               // "valid until 2026-05-30", "10 days"
  "sampleAvailable": boolean | null,
  "notes": string | null,                  // 1-2 sentences of anything else relevant
  "hasNoOffer": boolean                    // true if the thread has no offer-shaped content yet
}

Be conservative — null over guessing. If the thread is just intro/banter with no concrete numbers, set hasNoOffer=true and leave price fields null.`,
          messages: [{
            role: "user",
            content: `EMAIL THREAD (subject: "${thread.subject}", ${thread.messages.length} messages):\n\n${transcript}`,
          }],
        });

        const text = result.content[0].type === "text" ? result.content[0].text : "";
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return;
        let parsed: Partial<SupplierOffer> & { hasNoOffer?: boolean };
        try { parsed = JSON.parse(m[0]); } catch { return; }
        await thread_persist(thread.id, parsed);
        extracted++;
      } catch { /* one bad thread shouldn't fail the batch */ }
    }));
  }

  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  return { ok: true, threads: candidates.length, extracted };
}

async function thread_persist(threadId: string, parsed: Partial<SupplierOffer> & { hasNoOffer?: boolean }) {
  await prisma.emailThread.update({
    where: { id: threadId },
    data: {
      supplierOffer: JSON.stringify(parsed),
      supplierOfferAt: new Date(),
    },
  });
}

