"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "./auth";
import { prisma } from "./prisma";

export async function createInquiryFromThread(threadId: string): Promise<{ ok: true; inquiryId: string } | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, officeId: session.officeId },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!thread) return { error: "Thread not found" };
  if (thread.inquiryId) return { error: "Thread already linked to an inquiry" };
  if (thread.messages.length === 0) return { error: "No messages in thread" };

  // Build a chronological transcript for the AI
  const transcript = thread.messages.map((m) => {
    const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
    return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\nSubject: ${m.subject ?? "(none)"}\n\n${m.bodyText ?? ""}`.trim();
  }).join("\n\n────\n\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 700,
    system: `You are a freight forwarding office assistant. The user wants to create a single Inquiry record from a thread of emails that are all related to one shipment. Read the entire thread (multiple sent + received messages) and extract a consolidated inquiry.

CRITICAL — distinguish job type:
- "SOURCING" = the office is helping the customer FIND/BUY a commodity from a supplier (negotiating with sellers, asking about price-per-ton, contract terms, payment, sample quality). The conversation is about purchasing the goods, not just moving them.
- "FORWARDING" = the office is moving cargo the customer already owns from A to B (booking carriers, container quotes, BL, customs clearance, ETA tracking).

Output ONLY a JSON object, no markdown:
{
  "type": "SOURCING" | "FORWARDING",
  "subject": string,                      // clean subject summarizing the shipment/deal
  "fromEmail": string | null,             // customer/sender email if identifiable
  "fromCompany": string | null,           // sender company name if identifiable
  "summary": string,                      // 1-2 sentences describing the deal AND its current stage
  "origin": string | null,                // city + country if known (e.g. "Ashgabat, TM")
  "destination": string | null,
  "mode": "SEA-FCL" | "SEA-LCL" | "AIR" | "ROAD" | "COURIER" | null,
  "containerType": "20GP" | "40GP" | "40HC" | "LCL" | null,
  "incoterms": string | null,             // e.g. "FOB", "CIF"
  "commodity": string | null,             // e.g. "Soybean meal 46-47% protein"
  "weight": number | null,                // kg
  "volume": number | null,                // cbm
  "cargoReadyDate": string | null         // ISO date
}

Be conservative — null is better than guessing. If a thread has BOTH sourcing and forwarding aspects, choose the dominant one (whichever stage the conversation is currently in).`,
    messages: [{
      role: "user",
      content: `EMAIL THREAD (subject: "${thread.subject}", ${thread.messages.length} messages):\n\n${transcript.slice(0, 12000)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }

  // Aggregate raw email body for the Inquiry's record
  const rawBody = thread.messages.map((m) =>
    `--- ${m.direction} from ${m.fromEmail} on ${m.sentAt.toISOString().split("T")[0]} ---\n${m.bodyText ?? ""}`
  ).join("\n\n").slice(0, 20000);

  const inquiry = await prisma.inquiry.create({
    data: {
      officeId: session.officeId,
      subject: parsed.subject ?? thread.subject ?? "Email thread",
      fromEmail: parsed.fromEmail ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromEmail ?? null,
      fromCompany: parsed.fromCompany ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromName ?? null,
      type: parsed.type === "SOURCING" ? "SOURCING" : "FORWARDING",
      status: "PARSED",
      rawEmailBody: rawBody,
      parsedData: JSON.stringify({ ...parsed, source: "thread", threadId }),
      origin: parsed.origin ?? null,
      destination: parsed.destination ?? null,
      mode: parsed.mode ?? null,
      containerType: parsed.containerType ?? null,
      incoterms: parsed.incoterms ?? null,
      commodity: parsed.commodity ?? null,
      weight: parsed.weight != null ? Number(parsed.weight) : null,
      volume: parsed.volume != null ? Number(parsed.volume) : null,
      cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate) : null,
      notes: parsed.summary ?? null,
      receivedAt: thread.messages[0].sentAt,
    },
  });

  // Link the thread (and all its messages by extension) to the new inquiry
  await prisma.emailThread.update({
    where: { id: threadId },
    data: { inquiryId: inquiry.id },
  });

  // Re-classify all unclassified / other / related-note inbound messages on this thread
  await prisma.emailMessage.updateMany({
    where: { threadId, direction: "INBOUND", OR: [{ classification: null }, { classification: "OTHER" }, { classification: "RELATED_NOTE" }] },
    data: { classification: "RELATED_NOTE", classificationReason: "Attached when thread was promoted to Inquiry", classificationAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  return { ok: true, inquiryId: inquiry.id };
}

export async function attachThreadToJob(threadId: string, jobId: string): Promise<void> {
  const session = await requireSession();
  // Verify both belong to this office
  const [thread, job] = await Promise.all([
    prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } }),
    prisma.job.findFirst({ where: { id: jobId, officeId: session.officeId }, select: { id: true } }),
  ]);
  if (!thread || !job) return;
  await prisma.emailThread.update({
    where: { id: threadId },
    data: { jobId, inquiryId: null },
  });
  revalidatePath("/dashboard/inbox");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard");
}

export async function markThreadUnrelated(threadId: string): Promise<void> {
  const session = await requireSession();
  await prisma.emailThread.findFirst({ where: { id: threadId, officeId: session.officeId } });
  // We don't have a "marked unrelated" flag; for now just clear any links
  await prisma.emailThread.update({
    where: { id: threadId },
    data: { jobId: null, inquiryId: null },
  });
  await prisma.emailMessage.updateMany({
    where: { threadId },
    data: { classification: "OTHER", classificationReason: "Manually marked unrelated" },
  });
  revalidatePath("/dashboard/inbox");
}
