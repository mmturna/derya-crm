"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { populateJobFromEmails } from "@/lib/job-populate";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  reply: string;
  /** True if the agent ingested a new RFQ during this turn. Client refreshes data. */
  ingestedInquiryId?: string;
};

const SYSTEM = `You are the in-app agent for Derya Freight OS, a freight forwarding & procurement platform for an Istanbul-based forwarding office.

Your job:
- Answer the user's questions about their freight pipeline, jobs, RFQs, customers, milestones, margins.
- Suggest concrete next actions when asked. Reference job references like JOB-2025-005 and RFQ subjects.
- Be terse, professional, and operational. No emojis. No markdown headers. Plain prose, max 150 words unless asked for detail.
- If the user pastes what looks like an inbound freight RFQ email (multi-paragraph, has shipping context like origin/destination/mode/weight or words like "shipment", "container", "FCL", "LCL", "ETD", "ETA", "freight"), you should NOT analyze it inline — instead reply with a single sentence confirming you'll ingest it (the system will create an Inquiry separately).
- For all other questions, ground your answer in the OPS CONTEXT provided.
- Never fabricate a job or RFQ that's not in the context.
- When the user is focused on a job and asks you to populate, fill, extract, or create load details / specs / fields from the linked emails — **do not ask follow-up questions about weight, port, etc.** The system intercepts that intent and runs an extraction over every linked email automatically. You will only see the resulting fields, not the original ask. If a user asks something where extraction would help and you don't have enough context to answer, suggest they ask "extract load details from the emails".`;

const RFQ_KEYWORDS = /\b(FCL|LCL|RFQ|quote|shipment|container|ETD|ETA|freight|cargo|BL|TEU|shipping|Incoterms|EXW|FOB|DAP|DDP|forwarder|carrier|ocean|airfreight|trucking)\b/i;

function looksLikePopulateIntent(text: string): boolean {
  const t = text.toLowerCase();
  // verbs that mean "do it"
  const verb = /\b(populate|fill|extract|create|derive|generate|build|set|update|complete|read)\b/.test(t);
  // nouns referring to the job's structured fields
  const noun = /\b(load\s*detail|shipment\s*detail|job\s*detail|details|specs|fields|the\s*load|the\s*job|origin|destination|route|incoterms|weight|volume|commodity)\b/.test(t);
  // "from emails / based on emails / from the thread / from messages"
  const source = /\b(email|emails|thread|threads|message|messages|inbox|conversation|the\s*messages)\b/.test(t);
  // direct asks
  const direct = /\b(populate the load|fill (in|out) the (load|job)|create the load|extract the (specs|fields|details)|read the emails)\b/.test(t);
  return direct || (verb && noun) || (verb && source);
}

function looksLikeRFQ(text: string): boolean {
  if (text.length < 80) return false;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  return RFQ_KEYWORDS.test(text);
}

async function buildOpsContext(officeId: string) {
  const [activeJobs, pendingRFQs, recentCarrierQuotes] = await Promise.all([
    prisma.job.findMany({
      where: { officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      include: { company: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.inquiry.findMany({
      where: { officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
      include: { company: { select: { name: true } }, carrierQuotes: { select: { id: true, status: true } } },
      orderBy: { receivedAt: "desc" },
      take: 10,
    }),
    prisma.carrierQuote.findMany({
      where: { inquiry: { officeId }, status: "RECEIVED" },
      include: { inquiry: { select: { subject: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const jobLines = activeJobs.map((j) => {
    const margin = j.revenue && j.cost ? `${(((j.revenue - j.cost) / j.revenue) * 100).toFixed(0)}%` : "—";
    return `- ${j.reference} | ${j.company?.name ?? "no customer"} | ${j.origin ?? "?"} → ${j.destination ?? "?"} | ${j.mode ?? "—"} | ${j.status}${j.eta ? ` | ETA ${j.eta.toISOString().split("T")[0]}` : ""} | margin ${margin}`;
  });

  const rfqLines = pendingRFQs.map((r) => {
    const got = r.carrierQuotes.filter((q) => q.status === "RECEIVED").length;
    const sent = r.carrierQuotes.length;
    const procurement = sent > 0 ? ` | ${got}/${sent} replies` : "";
    return `- "${r.subject}" | ${r.company?.name ?? r.fromCompany ?? r.fromEmail ?? "?"} | ${r.origin ?? "?"} → ${r.destination ?? "?"} | ${r.mode ?? "—"} | ${r.status}${procurement}`;
  });

  const cqLines = recentCarrierQuotes.slice(0, 6).map((cq) => {
    const total = cq.total40HC ?? cq.total40 ?? cq.total20;
    return `- ${cq.carrier} on "${cq.inquiry?.subject ?? "?"}" | ${total ? `$${total.toLocaleString()}` : "?"}${cq.transitDays ? ` | ${cq.transitDays}d` : ""}`;
  });

  return `OPS CONTEXT (current state of this office)

Active jobs (${activeJobs.length}):
${jobLines.join("\n") || "  (none)"}

Pending RFQs (${pendingRFQs.length}):
${rfqLines.join("\n") || "  (none)"}

Recent carrier rate replies:
${cqLines.join("\n") || "  (none)"}`;
}

export async function chatWithAgent(history: ChatMsg[], userMessage: string, scopeJobId?: string): Promise<ChatResult> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { reply: "Agent unavailable — ANTHROPIC_API_KEY is not configured. Add it to .env to enable the chat." };
  }

  // Branch 1: Pasted RFQ → ingest as Inquiry and parse
  if (looksLikeRFQ(userMessage)) {
    const subjectMatch = userMessage.match(/^(?:Subject:\s*)?(.+?)$/m);
    const fromMatch = userMessage.match(/(?:from|sender):\s*(.+)/i) ||
                       userMessage.match(/<([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})>/) ||
                       userMessage.match(/\b([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/);
    const subject = subjectMatch?.[1]?.trim().slice(0, 120) ?? "Pasted RFQ";
    const fromEmail = fromMatch?.[1]?.trim() ?? null;

    const inquiry = await prisma.inquiry.create({
      data: {
        officeId: session.officeId,
        subject,
        fromEmail,
        status: "INGESTED",
        rawEmailBody: userMessage,
        receivedAt: new Date(),
      },
    });

    // Try parsing immediately so the user sees something
    try {
      const client = new Anthropic({ apiKey });
      const parseRes = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `Extract freight details from this email. Return ONLY valid JSON. Fields (use null if missing): origin, destination, mode (SEA-FCL|SEA-LCL|AIR|ROAD|COURIER), containerType (20GP|40GP|40HC|LCL), incoterms, commodity, weight (kg as number), volume (cbm as number), cargoReadyDate (ISO date).\n\nEmail:\n${userMessage.slice(0, 2500)}`,
        }],
      });
      const text = parseRes.content[0].type === "text" ? parseRes.content[0].text : "";
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        await prisma.inquiry.update({
          where: { id: inquiry.id },
          data: {
            origin: parsed.origin ?? null,
            destination: parsed.destination ?? null,
            mode: parsed.mode ?? null,
            containerType: parsed.containerType ?? null,
            incoterms: parsed.incoterms ?? null,
            commodity: parsed.commodity ?? null,
            weight: parsed.weight != null ? Number(parsed.weight) : null,
            volume: parsed.volume != null ? Number(parsed.volume) : null,
            cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate) : null,
            status: "PARSED",
            parsedData: JSON.stringify(parsed),
          },
        });
        revalidatePath("/dashboard");
        revalidatePath("/dashboard/rfq");
        const summary = [
          parsed.origin && parsed.destination ? `${parsed.origin} → ${parsed.destination}` : null,
          parsed.mode,
          parsed.weight ? `${parsed.weight}kg` : null,
          parsed.incoterms,
        ].filter(Boolean).join(" · ");
        return {
          reply: `Captured and parsed. Created RFQ "${subject}" — ${summary || "details extracted"}. Visible in the queue now. Open the RFQ inbox to send rate requests.`,
          ingestedInquiryId: inquiry.id,
        };
      }
    } catch {
      // fall through
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/rfq");
    return {
      reply: `Captured RFQ "${subject}" in the inbox. AI parsing didn't return clean JSON — open the RFQ to fill fields manually.`,
      ingestedInquiryId: inquiry.id,
    };
  }

  // Branch 1.5: When focused on a specific job, detect "populate / fill / extract
  // load details from emails" intent and execute it directly. The agent has no
  // tool-use loop yet, so we intercept the common ask.
  if (scopeJobId && looksLikePopulateIntent(userMessage)) {
    const r = await populateJobFromEmails(scopeJobId);
    if ("error" in r) {
      return { reply: `Couldn't populate the load: ${r.error}` };
    }
    if (r.filled.length === 0) {
      return { reply: `Read the linked emails. Nothing new to fill — every field on this job already has a value, or the emails don't contain extractable shipment details. Open the job to edit fields manually.` };
    }
    return {
      reply: `Populated load details from emails:\n${r.filled.map((f) => `· ${f}`).join("\n")}\n\nOpen the job to review or override any field.`,
    };
  }

  // Branch 2: Q&A with ops context (optionally scoped to a job)
  const ctx = await buildOpsContext(session.officeId);
  let scopedCtx = "";
  if (scopeJobId) {
    const job = await prisma.job.findFirst({
      where: { id: scopeJobId, officeId: session.officeId },
      include: {
        company: { select: { name: true } },
        inquiry: { include: { carrierQuotes: true } },
        documents: true,
        milestones: true,
      },
    });
    if (job) {
      const margin = job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(0)}%` : "—";
      const quotes = job.inquiry?.carrierQuotes
        .map((q) => `  - ${q.carrier}: ${q.status === "RECEIVED" ? `$${(q.total40HC ?? q.total40 ?? q.total20 ?? 0).toLocaleString()}, ${q.transitDays ?? "?"}d` : "pending"}`)
        .join("\n") ?? "  (none)";
      const milestones = job.milestones
        .map((m) => `  - ${m.type}: ${m.actualAt ? `confirmed ${m.actualAt.toISOString().split("T")[0]}` : m.plannedAt ? `planned ${m.plannedAt.toISOString().split("T")[0]}` : "not set"}`)
        .join("\n") || "  (none)";
      const docs = job.documents
        .map((d) => `  - ${d.name}: ${d.status.toLowerCase()}`)
        .join("\n") || "  (none)";
      scopedCtx = `

THE USER IS FOCUSED ON THIS JOB. Ground every answer in this job unless they ask about something else.

${job.reference} | ${job.company?.name ?? "no customer"} | ${job.origin ?? "?"} → ${job.destination ?? "?"} | ${job.mode ?? "—"} | ${job.status}
Revenue: ${job.revenue ? `$${job.revenue.toLocaleString()}` : "—"} | Cost: ${job.cost ? `$${job.cost.toLocaleString()}` : "—"} | Margin: ${margin}
ETD: ${job.etd ? job.etd.toISOString().split("T")[0] : "—"} | ETA: ${job.eta ? job.eta.toISOString().split("T")[0] : "—"}
${job.commodity ? `Commodity: ${job.commodity}` : ""}${job.weight ? ` | ${job.weight}kg` : ""}${job.volume ? ` | ${job.volume}cbm` : ""}${job.incoterms ? ` | ${job.incoterms}` : ""}

Carrier quotes:
${quotes}

Milestones:
${milestones}

Documents:
${docs}`;
    }
  }

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: SYSTEM + "\n\n" + ctx + scopedCtx,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ],
  });
  const text = msg.content[0].type === "text" ? msg.content[0].text : "(no response)";
  return { reply: text.trim() };
}
