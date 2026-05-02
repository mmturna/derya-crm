"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";

export type PopulateResult = {
  ok: true;
  jobId: string;
  filled: string[];        // human-readable list of fields filled
  raw: Record<string, unknown>;
} | {
  error: string;
};

// AI walks every email message on the job (via the linked Inquiry's threads)
// plus any extracted supplier offers, and fills missing fields on the Job.
// Idempotent: only writes fields that are currently null/empty on the Job —
// it doesn't overwrite operator-entered values. Returns a list of fields
// actually filled this run.
export async function populateJobFromEmails(jobId: string): Promise<PopulateResult> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: {
      inquiry: {
        include: {
          emailThreads: {
            include: { messages: { orderBy: { sentAt: "asc" } } },
          },
        },
      },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
    },
  });
  if (!job) return { error: "Job not found" };

  // Collect all email threads attached either via the job directly or via its inquiry.
  const threads = [
    ...job.emailThreads,
    ...(job.inquiry?.emailThreads ?? []),
  ];
  if (threads.length === 0) return { error: "No emails linked to this job to populate from" };

  const transcripts: string[] = [];
  const offerSummaries: string[] = [];
  for (const t of threads) {
    if (t.messages.length === 0) continue;
    const body = t.messages.map((m) => {
      const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
      return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\n${m.bodyText ?? ""}`;
    }).join("\n\n────\n\n");
    transcripts.push(`THREAD: "${t.subject}"\n\n${body}`);

    if (t.supplierOffer) {
      try {
        const o = JSON.parse(t.supplierOffer);
        const summary = `Supplier ${o.supplierName ?? "?"} | ${o.pricePerUnit ?? "?"} ${o.currency ?? ""}/${o.unit ?? ""} | qty ${o.qtyAvailable ?? "?"} | ${o.incoterms ?? ""} | origin ${o.origin ?? "?"} | lead ${o.leadTime ?? "?"}`;
        offerSummaries.push(summary);
      } catch {}
    }
  }

  const fullText = (transcripts.join("\n\n════\n\n") + (offerSummaries.length ? `\n\nSUPPLIER OFFERS PARSED EARLIER:\n${offerSummaries.join("\n")}` : "")).slice(0, 18000);

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: `You consolidate an entire email/conversation history about ONE freight deal into a structured load record.

Job type: ${job.type} (${job.type === "SOURCING" ? "office is buying a commodity for a customer" : "office is moving cargo for a customer"})

Output ONLY this JSON (no markdown, no commentary):
{
  "origin": string | null,            // city, country code (e.g. "Constanta, RO" or "Turkey" if only country known)
  "destination": string | null,
  "mode": "SEA-FCL" | "SEA-LCL" | "AIR" | "ROAD" | "COURIER" | null,
  "containerType": "20GP" | "40GP" | "40HC" | "LCL" | null,
  "incoterms": string | null,         // FOB, CIF, EXW, DAP, etc
  "commodity": string | null,         // specific (e.g. "Animal feed grade soybean meal, 46% protein")
  "weight": number | null,            // kg
  "volume": number | null,            // cbm
  "packages": number | null,          // pallets/bags/units count
  "etd": string | null,               // ISO date if mentioned
  "eta": string | null,
  "cargoReadyDate": string | null,
  "revenue": number | null,           // total customer-facing price (USD)
  "cost": number | null,              // best supplier/carrier cost (USD)
  "currency": "USD" | "EUR" | "GBP" | "TRY" | null,
  "notes": string | null              // 2-3 sentences operational summary: who's involved, current stage, key open question
}

Be conservative — null is better than guessing. Use the supplier offers section to inform cost. If only one country is mentioned (e.g. "Turkey", "United Kingdom"), put it in origin/destination as-is — better than null. Convert weights from MT to kg (×1000). For SOURCING jobs the buyer is the customer and origin is the supplier's country.`,
    messages: [{
      role: "user",
      content: fullText,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }

  // Build update: only fill fields that are currently empty on the Job.
  const update: Record<string, unknown> = {};
  const filled: string[] = [];
  const tryFill = (key: string, currentVal: unknown, parsedVal: unknown, label: string) => {
    if (parsedVal == null || parsedVal === "") return;
    if (currentVal != null && currentVal !== "") return;
    update[key] = parsedVal;
    filled.push(`${label}: ${String(parsedVal)}`);
  };

  tryFill("origin",        job.origin,        parsed.origin,        "Origin");
  tryFill("destination",   job.destination,   parsed.destination,   "Destination");
  tryFill("mode",          job.mode,          parsed.mode,          "Mode");
  tryFill("incoterms",     job.incoterms,     parsed.incoterms,     "Incoterms");
  tryFill("commodity",     job.commodity,     parsed.commodity,     "Commodity");
  tryFill("notes",         job.notes,         parsed.notes,         "Notes");
  if (parsed.weight != null && (job.weight == null || job.weight === 0)) {
    update.weight = Number(parsed.weight);
    filled.push(`Weight: ${Number(parsed.weight).toLocaleString()} kg`);
  }
  if (parsed.volume != null && (job.volume == null || job.volume === 0)) {
    update.volume = Number(parsed.volume);
    filled.push(`Volume: ${Number(parsed.volume).toLocaleString()} cbm`);
  }
  if (parsed.packages != null && (job.packages == null || job.packages === 0)) {
    update.packages = Number(parsed.packages);
    filled.push(`Packages: ${Number(parsed.packages)}`);
  }
  if (parsed.etd && job.etd == null) {
    const d = new Date(String(parsed.etd));
    if (!isNaN(d.getTime())) { update.etd = d; filled.push(`ETD: ${d.toISOString().split("T")[0]}`); }
  }
  if (parsed.eta && job.eta == null) {
    const d = new Date(String(parsed.eta));
    if (!isNaN(d.getTime())) { update.eta = d; filled.push(`ETA: ${d.toISOString().split("T")[0]}`); }
  }
  if (parsed.revenue != null && (job.revenue == null || job.revenue === 0)) {
    update.revenue = Number(parsed.revenue);
    filled.push(`Revenue: $${Number(parsed.revenue).toLocaleString()}`);
  }
  if (parsed.cost != null && (job.cost == null || job.cost === 0)) {
    update.cost = Number(parsed.cost);
    filled.push(`Cost: $${Number(parsed.cost).toLocaleString()}`);
  }
  if (parsed.currency && job.currency === "USD") {
    // currency defaults to USD on creation; only override if AI is confident
    if (parsed.currency !== "USD") {
      update.currency = String(parsed.currency);
      filled.push(`Currency: ${parsed.currency}`);
    }
  }

  if (Object.keys(update).length > 0) {
    await prisma.job.update({ where: { id: job.id }, data: update });
  }

  // Mirror onto the inquiry too, so the RFQ page reflects it.
  if (job.inquiry) {
    const inqUpdate: Record<string, unknown> = {};
    const tryFillInq = (key: string, currentVal: unknown, parsedVal: unknown) => {
      if (parsedVal == null || parsedVal === "") return;
      if (currentVal != null && currentVal !== "") return;
      inqUpdate[key] = parsedVal;
    };
    tryFillInq("origin",        job.inquiry.origin,        parsed.origin);
    tryFillInq("destination",   job.inquiry.destination,   parsed.destination);
    tryFillInq("mode",          job.inquiry.mode,          parsed.mode);
    tryFillInq("incoterms",     job.inquiry.incoterms,     parsed.incoterms);
    tryFillInq("commodity",     job.inquiry.commodity,     parsed.commodity);
    if (parsed.weight != null && (job.inquiry.weight == null)) inqUpdate.weight = Number(parsed.weight);
    if (parsed.volume != null && (job.inquiry.volume == null)) inqUpdate.volume = Number(parsed.volume);
    if (parsed.containerType && job.inquiry.containerType == null) inqUpdate.containerType = parsed.containerType;
    if (parsed.cargoReadyDate && job.inquiry.cargoReadyDate == null) {
      const d = new Date(String(parsed.cargoReadyDate));
      if (!isNaN(d.getTime())) inqUpdate.cargoReadyDate = d;
    }
    if (Object.keys(inqUpdate).length > 0) {
      await prisma.inquiry.update({ where: { id: job.inquiry.id }, data: inqUpdate });
    }
  }

  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  if (job.inquiry) revalidatePath(`/dashboard/rfq/${job.inquiry.id}`);
  revalidatePath("/dashboard");

  return { ok: true, jobId, filled, raw: parsed };
}
