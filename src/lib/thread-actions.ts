"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";
import { createProposedJobForInquiry } from "./job-actions";

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

  // Spin up a draft Job on the kanban board for this inquiry.
  await createProposedJobForInquiry(inquiry.id);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return { ok: true, inquiryId: inquiry.id };
}

// Auto-version: same as createInquiryFromThread, but lets the AI return
// `{ skip: true, reason: "..." }` if the thread isn't freight-related, and
// records an attempt so we don't keep re-asking on every sync. Used by the
// post-sync auto-link pass — silent on failure, no redirects, no auth check
// (caller must have already verified office ownership of the thread).
export async function autoCreateInquiryFromThread(threadId: string): Promise<
  | { ok: true; created: false; reason: string }
  | { ok: true; created: true; inquiryId: string }
  | { ok: true; created: false; linkedInquiryId: string }
  | { ok: true; created: false; linkedJobId: string }
  | { error: string }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!thread) return { error: "Thread not found" };
  if (thread.jobId || thread.inquiryId) {
    await prisma.emailThread.update({ where: { id: threadId }, data: { autoLinkedAt: new Date() } });
    return { ok: true, created: false, reason: "already linked" };
  }
  if (thread.messages.length === 0) return { error: "No messages in thread" };

  // Pull open inquiries + active jobs in this office so the AI can match an
  // existing record instead of creating a duplicate.
  const [openInquiries, activeJobs] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: thread.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
      select: { id: true, subject: true, type: true, fromEmail: true, fromCompany: true, commodity: true, origin: true, destination: true, mode: true, company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 80,
    }),
    prisma.job.findMany({
      where: { officeId: thread.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { id: true, reference: true, type: true, origin: true, destination: true, mode: true, company: { select: { name: true } }, inquiry: { select: { fromEmail: true, commodity: true } } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
  ]);

  const inquiryHints = openInquiries.map((i) =>
    `${i.id} | ${i.type} | "${i.subject}" | ${i.fromEmail ?? i.fromCompany ?? "?"} | ${i.company?.name ?? "—"} | commodity: ${i.commodity ?? "—"} | ${i.origin ?? "?"} → ${i.destination ?? "?"} | ${i.mode ?? "—"}`
  ).join("\n");
  const jobHints = activeJobs.map((j) =>
    `${j.id} | ${j.reference} | ${j.type} | ${j.company?.name ?? "—"} | ${j.inquiry?.fromEmail ?? "—"} | commodity: ${j.inquiry?.commodity ?? "—"} | ${j.origin ?? "?"} → ${j.destination ?? "?"} | ${j.mode ?? "—"}`
  ).join("\n");

  const transcript = thread.messages.map((m) => {
    const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
    return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\nSubject: ${m.subject ?? "(none)"}\n\n${m.bodyText ?? ""}`.trim();
  }).join("\n\n────\n\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: `You are a freight forwarding office assistant. For an email thread, decide ONE of:

(a) SKIP — thread is not freight-related (newsletter, security alert, calendar, banking, marketing, personal, generic platform notification):
    { "action": "skip", "reason": "<short sentence>" }

(b) LINK — thread is about a deal we ALREADY track. **STRONGLY prefer linking over creating.** Multiple suppliers / multiple negotiations / multiple email threads about the SAME commodity-and-buyer typically belong to ONE deal. Examples:
    - Five different "Re: Soybean Meal" threads from five different suppliers → ALL link to the SAME existing soybean inquiry.
    - "Re: Quotation for Corn Gluten Meal" + "Corn Gluten Meal Sample" + "CGM lead time" → ALL link to one corn-gluten-meal sourcing inquiry.
    - Carrier reply threads about the same booking → link to the existing job.

  { "action": "link", "linkInquiryId": "<id>" | null, "linkJobId": "<id>" | null, "reason": "<short sentence>" }

(c) CREATE — thread is freight-related and is genuinely a NEW commodity/route/buyer not represented in the lists. Only choose this when no candidate is plausible.
    { "action": "create", "type": "SOURCING" | "FORWARDING", "subject": string, "fromEmail": string|null, "fromCompany": string|null, "summary": string, "origin": string|null, "destination": string|null, "mode": "SEA-FCL"|"SEA-LCL"|"AIR"|"ROAD"|"COURIER"|null, "containerType": "20GP"|"40GP"|"40HC"|"LCL"|null, "incoterms": string|null, "commodity": string|null, "weight": number|null, "volume": number|null, "cargoReadyDate": string|null }

SOURCING = office helps customer FIND/BUY a commodity (price-per-ton talk, contracts, samples). For SOURCING, ONE inquiry usually has MANY supplier-conversation threads — link, don't duplicate.
FORWARDING = office moves cargo customer already owns (carriers, BL, customs, ETA).

Strong LINK signals (ANY one is enough — be aggressive):
- The commodity keyword in the thread matches an existing inquiry's commodity field, even loosely (e.g. "soybean", "soybean meal", "SBM", "animal feed soybean" all match a "Soybean Meal" inquiry).
- Sender email matches an inquiry's fromEmail OR sender domain matches the customer/contact domain on any open record.
- Same origin or destination country combined with same commodity family.
- Reply chains, Re:/Fwd: subject lines whose stem matches an existing subject.
- Shared booking/BL/container reference number.

When in doubt between LINK and CREATE: choose LINK. Duplicate inquiries are worse than over-linking — the operator can split later.

Output ONLY the JSON object, no markdown.

OPEN INQUIRIES (id | type | subject | sender | customer | commodity | route | mode):
${inquiryHints || "(none)"}

ACTIVE JOBS (id | ref | type | customer | source-email | commodity | route | mode):
${jobHints || "(none)"}`,
    messages: [{
      role: "user",
      content: `EMAIL THREAD (subject: "${thread.subject}", ${thread.messages.length} messages):\n\n${transcript.slice(0, 12000)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    await prisma.emailThread.update({ where: { id: threadId }, data: { autoLinkedAt: new Date(), autoLinkSkipReason: "AI returned no JSON" } });
    return { ok: true, created: false, reason: "AI returned no JSON" };
  }
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch {
    await prisma.emailThread.update({ where: { id: threadId }, data: { autoLinkedAt: new Date(), autoLinkSkipReason: "AI JSON parse failed" } });
    return { ok: true, created: false, reason: "JSON parse failed" };
  }

  // Back-compat: older prompt used `skip: true`.
  const action: string = parsed.action ?? (parsed.skip ? "skip" : "create");

  if (action === "skip") {
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 240) : "not freight related";
    await prisma.emailThread.update({
      where: { id: threadId },
      data: { autoLinkedAt: new Date(), autoLinkSkipReason: reason },
    });
    return { ok: true, created: false, reason };
  }

  if (action === "link") {
    const linkInquiryId = typeof parsed.linkInquiryId === "string" ? parsed.linkInquiryId : null;
    const linkJobId = typeof parsed.linkJobId === "string" ? parsed.linkJobId : null;

    // Verify the id exists in this office before linking.
    if (linkInquiryId) {
      const inq = await prisma.inquiry.findFirst({ where: { id: linkInquiryId, officeId: thread.officeId }, select: { id: true } });
      if (inq) {
        await prisma.emailThread.update({
          where: { id: threadId },
          data: { inquiryId: inq.id, autoLinkedAt: new Date() },
        });
        await prisma.emailMessage.updateMany({
          where: { threadId, direction: "INBOUND", OR: [{ classification: null }, { classification: "OTHER" }] },
          data: { classification: "RELATED_NOTE", classificationReason: "Auto-linked to existing inquiry", classificationAt: new Date() },
        });
        // Make sure the inquiry has a draft Job on the board.
        await createProposedJobForInquiry(inq.id);
        return { ok: true, created: false, linkedInquiryId: inq.id };
      }
    }
    if (linkJobId) {
      const job = await prisma.job.findFirst({ where: { id: linkJobId, officeId: thread.officeId }, select: { id: true } });
      if (job) {
        await prisma.emailThread.update({
          where: { id: threadId },
          data: { jobId: job.id, autoLinkedAt: new Date() },
        });
        await prisma.emailMessage.updateMany({
          where: { threadId, direction: "INBOUND", OR: [{ classification: null }, { classification: "OTHER" }] },
          data: { classification: "RELATED_NOTE", classificationReason: "Auto-linked to existing job", classificationAt: new Date() },
        });
        return { ok: true, created: false, linkedJobId: job.id };
      }
    }
    // AI said link but didn't give a valid id — fall through to skip.
    await prisma.emailThread.update({
      where: { id: threadId },
      data: { autoLinkedAt: new Date(), autoLinkSkipReason: "AI proposed link but id not found" },
    });
    return { ok: true, created: false, reason: "AI proposed link but id not found" };
  }

  // CREATE path
  const rawBody = thread.messages.map((mm) =>
    `--- ${mm.direction} from ${mm.fromEmail} on ${mm.sentAt.toISOString().split("T")[0]} ---\n${mm.bodyText ?? ""}`
  ).join("\n\n").slice(0, 20000);

  const inquiry = await prisma.inquiry.create({
    data: {
      officeId: thread.officeId,
      subject: parsed.subject ?? thread.subject ?? "Email thread",
      fromEmail: parsed.fromEmail ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromEmail ?? null,
      fromCompany: parsed.fromCompany ?? thread.messages.find((x) => x.direction === "INBOUND")?.fromName ?? null,
      type: parsed.type === "SOURCING" ? "SOURCING" : "FORWARDING",
      status: "PARSED",
      rawEmailBody: rawBody,
      parsedData: JSON.stringify({ ...parsed, source: "thread-auto", threadId }),
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

  await prisma.emailThread.update({
    where: { id: threadId },
    data: { inquiryId: inquiry.id, autoLinkedAt: new Date() },
  });

  await prisma.emailMessage.updateMany({
    where: { threadId, direction: "INBOUND", OR: [{ classification: null }, { classification: "OTHER" }] },
    data: { classification: "RELATED_NOTE", classificationReason: "Attached when thread was auto-promoted to Inquiry", classificationAt: new Date() },
  });

  // Spin up a draft Job on the board for the new Inquiry.
  await createProposedJobForInquiry(inquiry.id);

  return { ok: true, created: true, inquiryId: inquiry.id };
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
