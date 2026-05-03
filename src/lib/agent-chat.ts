"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOOLS, dispatchTool } from "@/lib/agent-tools";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  reply: string;
  /** True if the agent ingested a new RFQ during this turn. Client refreshes data. */
  ingestedInquiryId?: string;
};

const SYSTEM = `You are the in-app agent for Derya Freight OS — a freight forwarding & procurement platform for an Istanbul-based office.

You have a set of tools (see the tools list). USE THEM. Do not describe what you would do — call the tool and report the actual result.

When the user asks a question:
- If the answer requires looking up data you don't already have (jobs, inquiries, threads, customers, supplier offers, carrier rates, milestones, etc.) — **call the right search/lookup tool first**, then answer.
- Don't say "I don't see X in my view" — search for it. There are search_jobs, search_inquiries, search_companies, search_email_threads, get_job, list_open_inquiries, list_threads_awaiting_reply, list_stuck_jobs, summarize_supplier_offers, summarize_carrier_rates.

**HARD RULE — never confuse pricing models:**
- A SOURCING (procurement) job's pricing is **SUPPLIER OFFERS**, NOT carrier quotes. Suppliers are the parties selling the commodity. When the user asks about "rates" / "prices" / "offers" / "what we got" / "how much" on a SOURCING job, ALWAYS call summarize_supplier_offers — never mention carriers, never say "no carrier quotes yet."
- A FORWARDING (logistics) job's pricing is **CARRIER QUOTES**. Carriers are shipping lines / trucking companies. Use summarize_carrier_rates here.
- The focused job's type is in the scoped context below. Read it before answering.
- If summarize_supplier_offers returns no offers, your reply should say "no supplier replies yet" — or if there are linked threads but no parsed prices, suggest running extract_supplier_offers / link_threads_to_job. NEVER say "no carrier quotes" on a SOURCING job. That's wrong vocabulary.

When the user asks for an action (merge, award, populate, set, rename, edit, move stage, draft, hide, delete):
- Call the matching tool. Don't ask permission unless the action is destructive (delete_job).
- If the user is focused on a job, you don't need a job_id — the tool inherits scope.

Style:
- Be terse, operational, professional. No emojis. No markdown headers. Plain prose. Under 150 words unless the result genuinely needs more.
- After a tool call returns, briefly state what happened in human terms (e.g. "Awarded ORLAZUL — job moved to Awarded, child forwarding job spun up.") rather than dumping the JSON.
- When listing supplier offers / rates / stuck jobs, format as a short bulleted list with the most useful field first (price, days idle, etc).
- For SOURCING jobs the pricing comes from supplier offers (each linked thread has one). For FORWARDING jobs it's carrier quotes. Use the right tool for the job type.

What you CAN'T do:
- Modify users, offices, or auth data.
- Send arbitrary emails outside of the draft-reply / counter-offer / award flows.
- Bypass the platform — every action goes through a tool.

Never invent results. If a tool errored, say so. If you skipped calling a tool because the user's intent was unclear, ask one short clarifying question instead of guessing.`;

const RFQ_KEYWORDS = /\b(FCL|LCL|RFQ|quote|shipment|container|ETD|ETA|freight|cargo|BL|TEU|shipping|Incoterms|EXW|FOB|DAP|DDP|forwarder|carrier|ocean|airfreight|trucking)\b/i;

function looksLikeRFQ(text: string): boolean {
  if (text.length < 80) return false;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  return RFQ_KEYWORDS.test(text);
}

async function buildOpsContext(officeId: string) {
  const [activeJobs, pendingRFQs] = await Promise.all([
    prisma.job.findMany({
      where: { officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      include: { company: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
    prisma.inquiry.findMany({
      where: { officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 10,
    }),
  ]);

  const jobLines = activeJobs.map((j) =>
    `- ${j.reference} | ${j.type} | ${j.company?.name ?? "no customer"} | ${j.origin ?? "?"} → ${j.destination ?? "?"} | ${j.status}`
  );
  const rfqLines = pendingRFQs.map((r) =>
    `- "${r.subject}" | ${r.type} | ${r.company?.name ?? r.fromCompany ?? r.fromEmail ?? "?"} | ${r.origin ?? "?"} → ${r.destination ?? "?"} | ${r.status}`
  );

  return `OPS SNAPSHOT (current state of this office)

Active jobs (${activeJobs.length}):
${jobLines.join("\n") || "  (none)"}

Pending RFQs (${pendingRFQs.length}):
${rfqLines.join("\n") || "  (none)"}`;
}

async function buildScopedJobContext(jobId: string, officeId: string): Promise<string> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      company: { select: { name: true } },
      inquiry: { include: { emailThreads: { select: { id: true } } } },
      milestones: { select: { type: true, plannedAt: true, actualAt: true } },
    },
  });
  if (!job) return "";
  const threadCount = job.inquiry?.emailThreads.length ?? 0;
  const typeBlock = job.type === "SOURCING"
    ? `**THIS IS A PROCUREMENT (SOURCING) JOB.** Pricing = SUPPLIER OFFERS, not carrier quotes. For any "rate / price / offer / cheapest" question, call summarize_supplier_offers. To attach related supplier emails, call link_threads_to_job. To pick a winner, call award_supplier. NEVER call summarize_carrier_rates here. NEVER say "no carrier quotes" — the operator is asking about SUPPLIER prices.`
    : `**THIS IS A FORWARDING JOB.** Pricing = CARRIER QUOTES. For any "rate / price" question, call summarize_carrier_rates.`;

  return `

FOCUSED JOB (the user is currently looking at this — operate on it by default):
${job.reference} (${job.type}) | ${job.company?.name ?? "no customer"} | ${job.origin ?? "?"} → ${job.destination ?? "?"} | ${job.mode ?? "—"} | ${job.status}
Commodity: ${job.commodity ?? "—"} | Weight: ${job.weight ?? "—"}kg | Volume: ${job.volume ?? "—"}cbm
Revenue: ${job.revenue ?? "—"} | Cost: ${job.cost ?? "—"} | ETD: ${job.etd?.toISOString().split("T")[0] ?? "—"} | ETA: ${job.eta?.toISOString().split("T")[0] ?? "—"}
Inquiry id: ${job.inquiryId ?? "—"} | Linked email threads: ${threadCount}

${typeBlock}`;
}

export async function chatWithAgent(history: ChatMsg[], userMessage: string, scopeJobId?: string): Promise<ChatResult> {
  try {
    return await _chatWithAgentImpl(history, userMessage, scopeJobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : "";
    console.error("[agent-chat] top-level failed:", msg, stack);
    return { reply: `Agent error — ${msg.slice(0, 600)}${stack ? `\n\n${stack.slice(0, 400)}` : ""}` };
  }
}

async function _chatWithAgentImpl(history: ChatMsg[], userMessage: string, scopeJobId?: string): Promise<ChatResult> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { reply: "Agent unavailable — ANTHROPIC_API_KEY is not configured." };
  }

  // Branch 1: pasted RFQ → ingest as Inquiry (kept as a special case because
  // tool-use isn't the right shape for "the message itself is the data").
  if (looksLikeRFQ(userMessage)) {
    const subjectMatch = userMessage.match(/^(?:Subject:\s*)?(.+?)$/m);
    const fromMatch = userMessage.match(/(?:from|sender):\s*(.+)/i)
                   ?? userMessage.match(/<([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})>/)
                   ?? userMessage.match(/\b([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/);
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
    try {
      const client = new Anthropic({ apiKey });
      const parseRes = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `Extract freight details. Return ONLY JSON. Fields (null if missing): origin, destination, mode (SEA-FCL|SEA-LCL|AIR|ROAD|COURIER), containerType (20GP|40GP|40HC|LCL), incoterms, commodity, weight (kg), volume (cbm), cargoReadyDate (ISO).\n\n${userMessage.slice(0, 2500)}`,
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
      }
    } catch { /* ignore */ }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/rfq");
    return { reply: `Captured RFQ "${subject}". Open the inbox to see it parsed.`, ingestedInquiryId: inquiry.id };
  }

  // Branch 2: tool-use loop. The AI sees the snapshot + scoped-job context,
  // sees every tool with its schema, and decides what to call.
  const ctx = await buildOpsContext(session.officeId);
  const scopedCtx = scopeJobId ? await buildScopedJobContext(scopeJobId, session.officeId) : "";

  const client = new Anthropic({ apiKey });
  // Anthropic SDK message type is loose enough to accept raw blocks; using `any`
  // here keeps TS happy without type gymnastics.
  const messages: any[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  // Allow up to 8 sequential tool calls per turn (lookup → mutation → confirm).
  const MAX_TOOL_TURNS = 8;
  let lastTextReply = "";
  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM + "\n\n" + ctx + scopedCtx,
        tools: TOOLS as any,
        messages,
      });

      const textBlocks = response.content.filter((b: any) => b.type === "text") as any[];
      if (textBlocks.length) lastTextReply = textBlocks.map((b) => b.text).join("\n").trim();

      if (response.stop_reason !== "tool_use") {
        return { reply: lastTextReply || "(no reply)" };
      }

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter((b: any) => b.type === "tool_use") as any[];
      const toolResults: any[] = [];
      for (const tu of toolUseBlocks) {
        const r = await dispatchTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, {
          officeId: session.officeId,
          scopeJobId,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(r),
          is_error: !r.ok,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
    return { reply: lastTextReply || "Reached tool-call limit without a final answer. Try a more specific request." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent-chat] tool-use loop failed:", msg, e);
    return { reply: `Agent error — ${msg.slice(0, 400)}` };
  }
}
