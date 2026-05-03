"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { populateJobFromEmails } from "@/lib/job-populate";
import { extractSourcingOffersForInquiry } from "@/lib/sourcing-offers";
import { mergeAllOpenInquiriesIntoOne, consolidateDuplicateInquiries } from "@/lib/merge-actions";
import { awardSupplier, draftReplyToMessage } from "@/lib/sourcing-award";
import {
  extractActionFromMessage,
  applyEditJob, applyMoveStage, applyAddMilestone,
  applySetCustomer, applyRenameCompany, applyEditInquiry,
  applySetMoney, applyAddQuoteLine, applyDeleteJob,
} from "@/lib/agent-actions";
import { findStuckJobs } from "@/lib/stuck-jobs";
import { classifyAgentIntent } from "@/lib/agent-intent";

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
- **CRITICAL — DO NOT INVENT ACTIONS YOU TOOK.** If the system intercepted an action verb, you would not be in this branch — the system replies directly with the real result. By the time you're answering, that means the system did NOT run anything. So you must NEVER write phrases like "I merged...", "Running the merge now", "Job X has been consolidated", "Done", "Result: ...". You have no execute capability in this turn. If you think the user wanted an action, suggest a clearer phrasing: e.g. "If you'd like me to merge those, say 'merge all into one procurement' and I'll run it." Otherwise just answer the question.
- When the user is focused on a job and asks you to populate, fill, extract, or create load details / specs / fields from the linked emails — **do not ask follow-up questions about weight, port, etc.** The system intercepts that intent and runs an extraction over every linked email automatically. You will only see the resulting fields, not the original ask. If a user asks something where extraction would help and you don't have enough context to answer, suggest they ask "extract load details from the emails".
- You CAN take real actions in the platform. Specifically you can:
    1. Consolidate / categorize / merge / group multiple RFQs into ONE procurement (or forwarding) job — when the user says things like "merge all into one", "consolidate the soybean and corn gluten under one procurement", "categorize everything under one job", "group these RFQs", you can do it. The system intercepts that intent and runs the merge automatically.
    2. Find and dedupe duplicate inquiries: "merge duplicates", "find duplicates".
    3. Populate a job's load details from its linked emails (when scoped to a job).
    4. Award a supplier (when scoped to a SOURCING job): "award the cheapest", "go with ORLAZUL", "select the best offer". Picks the cheapest priced offer or the named supplier, advances the job to "Awarded", and drafts a confirmation email.
    5. Draft a reply to the latest inbound message on a job: "draft a reply", "write a response", "compose an email back to them". Optionally pass intent like "counter at $480/MT" or "ask for sample".
    6. List threads awaiting a reply: "what needs reply", "what's pending", "who's waiting on me".
    7. Hide unrelated threads in bulk: "hide unrelated", "mark spam as unrelated", "dismiss the noise".
    8. Edit a job's fields directly (when scoped to a job): "set ETD to May 20", "weight is 18 tons", "incoterms CIF". Multi-field updates work in one message.
    9. Move a job to a new stage: "mark this booked", "this is in transit now", "move to customs", "we received it".
    10. Log a milestone: "log that BL was issued today", "ETA confirmed for May 22", "cargo ready next Tuesday".
    11. Show stuck/stale jobs: "what's stuck", "stale jobs", "what needs attention".
    12. Morning briefing / daily digest: "morning briefing", "what's on my plate", "state of the pipeline".
    13. Set/link a customer: "the customer is ABC Corp", "set customer to ABC Corp", "this is for ABC Corp" — links existing or creates a new Company.
    14. Rename the linked customer: "rename customer to ABC Corp", "change customer name to Acme" — renames the underlying Company record.
    15. Edit the linked Inquiry / RFQ separately from the Job: "set RFQ subject to X", "the sender's email is foo@bar.com on the RFQ".
    16. Set revenue (price quoted to customer): "revenue is $12,500", "we charge €10k for this".
    17. Set cost (carrier/supplier expense): "cost is $8,200".
    18. Add a quote line: "add a line: customs clearance, $200".
    19. Delete this job: only when the user EXPLICITLY says "delete this job" / "remove this job" / "kill this job".
    20. Summarize supplier offers (SOURCING) or carrier rates (FORWARDING) for the focused job: "summary of best rates", "what are the supplier offers", "compare prices", "what's cheapest". The system extracts offers from emails on the fly if needed and ranks them.
  These actions execute server-side. The reply you see is the actual result.
  Never tell the user you "can't create / can't merge / it's a workflow they need to do manually" — these actions exist. If the request is ambiguous, run the action you think is closest and report what changed.`;

const RFQ_KEYWORDS = /\b(FCL|LCL|RFQ|quote|shipment|container|ETD|ETA|freight|cargo|BL|TEU|shipping|Incoterms|EXW|FOB|DAP|DDP|forwarder|carrier|ocean|airfreight|trucking)\b/i;

function detectNeedsReplyIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(what|which|who).*(need|needs|awaiting|waiting|pending).*(reply|response|answer|action)\b/.test(t)
    || /\b(awaiting reply|pending reply|needs reply|haven'?t replied|no response yet)\b/.test(t)
    || /\b(what should i (do|reply|answer|respond)|what's next)\b/.test(t);
}

function detectHideIntent(text: string): { matched: boolean; subjectHint?: string } {
  const t = text.toLowerCase();
  if (!/\b(hide|mark|flag|dismiss|ignore|skip|exclude)\b/.test(t)) return { matched: false };
  if (!/\b(unrelated|spam|noise|not[\s-]?freight|irrelevant|junk|newsletter|marketing|notification)\b/.test(t)) return { matched: false };
  // try to capture a subject hint
  const m = t.match(/(?:about|with subject|named|called|titled)\s+["']?([^"']{3,80})["']?/);
  return { matched: true, subjectHint: m?.[1]?.trim() };
}

function detectAwardIntent(text: string): { matched: boolean; supplierHint?: string } {
  const t = text.toLowerCase();
  if (!/\b(award|select|pick|choose|go with|accept|confirm|move forward with)\b/.test(t)) return { matched: false };
  if (!/\b(supplier|offer|cheapest|best|winner|deal)\b/.test(t)) return { matched: false };
  // Try to capture supplier name after "with X" / "to X" / "X's offer"
  const m = t.match(/(?:with|to|for|the)\s+([a-z][a-z0-9 .,&-]{2,40})\b/);
  return { matched: true, supplierHint: m?.[1]?.trim() };
}

function detectDraftReplyIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(draft|write|compose|prepare)\b/.test(t)) return false;
  if (!/\b(reply|response|email|answer|message)\b/.test(t)) return false;
  return true;
}

// Quick regex-only extraction of "300 MT to Ashgabat soybean meal"-style specs
// from a merge command. Used to pre-fill the keeper inquiry without an AI hop.
function extractMergeSpecs(text: string): { weightKg?: number; destination?: string; origin?: string; commodity?: string } {
  const out: { weightKg?: number; destination?: string; origin?: string; commodity?: string } = {};
  // Weight: "300 mt", "300mt", "300 metric tons", "300 tons", "300t"
  const wm = text.match(/\b(\d{1,5}(?:[.,]\d+)?)\s*(?:metric\s+ton|metric\s+tons|tonnes|tonne|tons|ton|t|mt)\b/i);
  if (wm) {
    const num = parseFloat(wm[1].replace(",", ""));
    if (!isNaN(num)) out.weightKg = Math.round(num * 1000);
  } else {
    const wkg = text.match(/\b(\d{2,7})\s*kg\b/i);
    if (wkg) out.weightKg = parseInt(wkg[1], 10);
  }
  // "to Ashgabat" / "to Hamburg, DE"
  const dm = text.match(/\bto\s+([A-Z][a-zA-Z .'-]{1,40}(?:,\s*[A-Za-z]{2,3})?)/);
  if (dm) out.destination = dm[1].trim();
  // "from Constanta" / "from Brazil"
  const om = text.match(/\bfrom\s+([A-Z][a-zA-Z .'-]{1,40}(?:,\s*[A-Za-z]{2,3})?)/);
  if (om) out.origin = om[1].trim();
  // Commodity heuristic — common freight commodities. Operator can still override later.
  const commodityMatch = text.match(/\b(soybean(?:\s+meal)?|corn(?:\s+gluten(?:\s+meal)?)?|wheat|rice|barley|maize|sunflower(?:\s+oil)?|cotton(?:seed)?(?:\s+cake)?|fish\s+meal|animal\s+feed|fertilizer|urea|ammonia|cement|steel|copper|aluminum)\b/i);
  if (commodityMatch) out.commodity = commodityMatch[1].replace(/\s+/g, " ").trim();
  return out;
}

function detectMergeIntent(text: string): { kind: "all-into-one" | "dedup" | "none"; type?: "SOURCING" | "FORWARDING" } {
  const t = text.toLowerCase();
  // SOURCING vs FORWARDING filter
  let type: "SOURCING" | "FORWARDING" | undefined;
  if (/\b(procurement|sourcing|buying|purchase|supplier)\b/.test(t)) type = "SOURCING";
  else if (/\b(forwarding|shipping|freight|logistics)\b/.test(t)) type = "FORWARDING";

  // Verbs that mean "smush them together"
  const verbHit = /\b(merge|consolidate|group|categorize|combine|unify|bundle|gather|collapse|fold|join)\b/.test(t);

  // Explicit "merge duplicates" first — more specific than all-into-one.
  const dedup =
    /\b(merge|consolidate|dedup|deduplicate|remove)\s+(duplicate|dupe|repeat)/.test(t) ||
    /\bfind\s+duplicates\b/.test(t) ||
    /\b(duplicate|duplicated)\s+(inquir|rfq|job|deal)/.test(t);
  if (dedup) return { kind: "dedup", type };

  // "all into one" patterns:
  const allIntoOne =
    verbHit && /\b(all|every|the|these|those|them)\b/.test(t)
    || /\b(under|into|to)\s+(one|a single|a)\s+(procurement|forwarding|sourcing|job|deal|rfq)\b/.test(t)
    || /\bone\s+(big|single|consolidated)\s+(procurement|forwarding|sourcing|job)\b/.test(t)
    || /\b(they|these|those)\s+(are|all)?\s*(all\s*)?(the\s*)?same\b/.test(t)            // "they are all the same"
    || /\b(same\s*(deal|thing|inquiry|job|rfq))\b/.test(t)                                // "same deal"
    || (verbHit && /\b(all|together|into one|under one)\b/.test(t));

  if (allIntoOne) return { kind: "all-into-one", type };
  return { kind: "none" };
}

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

  // Branch 1.20: "Morning briefing" / "what's on my plate" / "daily digest" —
  // aggregate snapshot across awaiting-reply + stuck + unawarded sourcing.
  if (/\b(morning brief(ing)?|daily digest|whats? on my plate|state of (the )?pipeline|where (are|do) we stand)\b/i.test(userMessage)) {
    const [needsReply, stuck, unawardedSourcing, openProposed] = await Promise.all([
      prisma.emailThread.findMany({
        where: { officeId: session.officeId, hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
        include: { messages: { orderBy: { sentAt: "desc" }, take: 1 }, job: { select: { reference: true } }, inquiry: { select: { subject: true } } },
        orderBy: { lastMessageAt: "desc" }, take: 50,
      }),
      findStuckJobs(session.officeId, { daysThreshold: 5, max: 5 }),
      prisma.inquiry.findMany({
        where: { officeId: session.officeId, type: "SOURCING", status: { in: ["PARSED", "PRICED", "QUOTED"] } },
        include: { _count: { select: { emailThreads: true } } },
        take: 20,
      }),
      prisma.job.count({ where: { officeId: session.officeId, status: "PROPOSED" } }),
    ]);
    const awaiting = needsReply.filter((t) => t.messages[0]?.direction === "INBOUND");
    const lines: string[] = [];
    lines.push(`Pipeline pulse — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`);
    lines.push("");
    if (openProposed > 0) lines.push(`· ${openProposed} proposed job${openProposed === 1 ? "" : "s"} awaiting your confirmation.`);
    if (awaiting.length > 0) lines.push(`· ${awaiting.length} thread${awaiting.length === 1 ? "" : "s"} need a reply from you.`);
    if (unawardedSourcing.length > 0) lines.push(`· ${unawardedSourcing.length} sourcing inquir${unawardedSourcing.length === 1 ? "y" : "ies"} still open — ${unawardedSourcing.filter((i) => i._count.emailThreads >= 2).length} have multiple supplier offers ready to compare.`);
    if (stuck.length > 0) {
      lines.push("");
      lines.push(`${stuck.length} stuck job${stuck.length === 1 ? "" : "s"} (>5 days idle):`);
      for (const s of stuck) lines.push(`  · ${s.reference} (${s.daysStuck}d) — ${s.suggestion}`);
    }
    if (lines.length === 2) lines.push("Nothing pending — pipeline is calm.");
    return { reply: lines.join("\n") };
  }

  // Branch 1.25: "What's stuck?" / "stale jobs" / "what needs attention" — radar.
  if (/\b(stuck|stale|stagnant|sitting|need.*attention|haven'?t moved|frozen)\b/i.test(userMessage)
      && /\b(job|jobs|deal|deals|load|loads|pipeline)\b/i.test(userMessage)) {
    const stuck = await findStuckJobs(session.officeId, { daysThreshold: 5, max: 8 });
    if (stuck.length === 0) {
      return { reply: "Pipeline looks healthy — no jobs older than 5 days without activity." };
    }
    const lines = stuck.map((s) =>
      `· ${s.reference} (${s.customer ?? "no customer"}, ${s.daysStuck}d stale) — ${s.suggestion}`
    );
    return {
      reply: `${stuck.length} stuck job${stuck.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}`,
    };
  }

  // Branch 1.3: "What needs reply?" — list awaiting-reply threads.
  if (detectNeedsReplyIntent(userMessage)) {
    const candidates = await prisma.emailThread.findMany({
      where: { officeId: session.officeId, hiddenAt: null },
      include: {
        messages: { orderBy: { sentAt: "desc" }, take: 1 },
        job: { select: { reference: true } },
        inquiry: { select: { subject: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    const awaiting = candidates.filter((t) => t.messages[0]?.direction === "INBOUND").slice(0, 8);
    if (awaiting.length === 0) {
      return { reply: "Inbox zero — no inbound threads waiting on a reply." };
    }
    const lines = awaiting.map((t) => {
      const last = t.messages[0];
      const tag = t.job?.reference ?? t.inquiry?.subject ?? "(unlinked)";
      return `· "${t.subject}" — ${tag} · last from ${last.fromName ?? last.fromEmail}`;
    });
    return {
      reply: `${awaiting.length} thread${awaiting.length === 1 ? "" : "s"} awaiting your reply:\n\n${lines.join("\n")}\n\nOpen the inbox "Awaiting reply" filter to draft replies.`,
    };
  }

  // Branch 1.35: "Hide unrelated threads" — quick triage helper.
  const hideIntent = detectHideIntent(userMessage);
  if (hideIntent.matched) {
    // Find unlinked threads classified as OTHER and hide them in bulk.
    const cands = await prisma.emailThread.findMany({
      where: {
        officeId: session.officeId,
        hiddenAt: null,
        jobId: null,
        inquiryId: null,
        messages: {
          every: { OR: [{ classification: "OTHER" }, { classification: null }] },
        },
      },
      take: 100,
      select: { id: true },
    });
    if (cands.length === 0) {
      return { reply: "No obviously-unrelated threads to hide. Open the inbox and use the Hide button on specific threads." };
    }
    await prisma.emailThread.updateMany({
      where: { id: { in: cands.map((c) => c.id) } },
      data: { hiddenAt: new Date() },
    });
    revalidatePath("/dashboard/inbox");
    return { reply: `Hid ${cands.length} unlinked thread${cands.length === 1 ? "" : "s"} classified as not freight-related. They're still under the "Hidden" filter if you need to recover any.` };
  }

  // Branch 1.4: Detect merge/consolidate intents before generic chat. These run
  // even when not scoped to a specific job — they operate across the office.
  const merge = detectMergeIntent(userMessage);
  if (merge.kind === "all-into-one") {
    // Try a quick spec extraction from the message so the keeper inherits
    // operator-stated subject/commodity/destination/weight without needing
    // the AI fallback path.
    const specs = extractMergeSpecs(userMessage);
    const r = await mergeAllOpenInquiriesIntoOne({ type: merge.type, ...specs });
    if ("error" in r) return { reply: `Couldn't consolidate: ${r.error}` };
    if (r.mergedCount === 0) return { reply: `Nothing to consolidate — only one open ${merge.type ?? ""} inquiry exists.` };
    const linkBit = r.keeperJobId ? ` Open it on the jobs board.` : "";
    return {
      reply: `Consolidated ${r.mergedCount + 1} ${merge.type ?? "open"} inquiries into one: "${r.subject}".${linkBit} You can split it back if any RFQ doesn't belong.`,
    };
  }
  if (merge.kind === "dedup") {
    const r = await consolidateDuplicateInquiries();
    if ("error" in r) return { reply: `Couldn't dedupe: ${r.error}` };
    if (r.merged === 0) return { reply: `No duplicates found across your open inquiries.` };
    return { reply: `Merged ${r.merged} duplicate inquiries into ${r.clusters} cleaned-up deal${r.clusters === 1 ? "" : "s"}.` };
  }

  // Branch 1.42: Structured-action extraction — only when focused on a job.
  // Catches "set ETD May 20", "mark this booked", "log BL issued today", etc.
  if (scopeJobId) {
    const job = await prisma.job.findFirst({
      where: { id: scopeJobId, officeId: session.officeId },
      select: { id: true, type: true, status: true, reference: true },
    });
    if (job) {
      const extracted = await extractActionFromMessage({
        userMessage,
        scopeJobId,
        scopeType: (job.type === "SOURCING" ? "SOURCING" : "FORWARDING"),
        scopeStatus: job.status,
      });
      if (extracted.action === "edit-job") {
        const r = await applyEditJob(scopeJobId, session.officeId, extracted.fields);
        if (r.applied.length === 0) {
          return { reply: `Couldn't apply any field updates from that — try being explicit, e.g. "set ETD to May 20" or "weight is 18 tons".` };
        }
        return { reply: `Updated ${job.reference}: ${r.applied.join(", ")}.` };
      }
      if (extracted.action === "move-stage") {
        const r = await applyMoveStage(scopeJobId, session.officeId, extracted.status);
        if ("error" in r) return { reply: `Couldn't change status: ${r.error}` };
        const procurement = job.type === "SOURCING";
        const labelMap: Record<string, string> = procurement
          ? { PROPOSED: "Proposed", INQUIRY: "Negotiating", QUOTED: "Award pending", BOOKED: "Awarded", IN_TRANSIT: "Shipping", CUSTOMS: "In transit", DELIVERED: "Received", CANCELLED: "Cancelled" }
          : { PROPOSED: "Proposed", INQUIRY: "Inquiry", QUOTED: "Quoted", BOOKED: "Booked", IN_TRANSIT: "In Transit", CUSTOMS: "Customs", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
        return { reply: `Moved ${job.reference} from ${labelMap[r.from] ?? r.from} to ${labelMap[r.to] ?? r.to}.` };
      }
      if (extracted.action === "add-milestone") {
        const r = await applyAddMilestone(scopeJobId, session.officeId, extracted);
        if ("error" in r) return { reply: `Couldn't log milestone: ${r.error}` };
        const when = extracted.actualAt ? `confirmed ${extracted.actualAt}` : extracted.plannedAt ? `planned ${extracted.plannedAt}` : "logged";
        return { reply: `Logged ${extracted.type.replace(/_/g, " ").toLowerCase()} milestone — ${when}.` };
      }
      if (extracted.action === "set-customer") {
        const r = await applySetCustomer(scopeJobId, session.officeId, extracted);
        if ("error" in r) return { reply: `Couldn't set customer: ${r.error}` };
        return { reply: r.created
          ? `Created customer "${r.companyName}" and linked it to ${job.reference}.`
          : `Linked existing customer "${r.companyName}" to ${job.reference}.` };
      }
      if (extracted.action === "rename-company") {
        const r = await applyRenameCompany(scopeJobId, session.officeId, extracted.newName);
        if ("error" in r) return { reply: `Couldn't rename: ${r.error}` };
        return { reply: `Renamed customer "${r.from}" → "${r.to}". Change is reflected on every job linked to this customer.` };
      }
      if (extracted.action === "edit-inquiry") {
        const r = await applyEditInquiry(scopeJobId, session.officeId, extracted.fields);
        if ("error" in r) return { reply: `Couldn't update inquiry: ${r.error}` };
        return { reply: `Updated the linked inquiry: ${r.applied.join(", ")}.` };
      }
      if (extracted.action === "set-revenue") {
        const r = await applySetMoney(scopeJobId, session.officeId, "revenue", extracted.amount, extracted.currency);
        if ("error" in r) return { reply: `Couldn't set revenue: ${r.error}` };
        return { reply: `Set revenue to ${(extracted.currency ?? "USD")} ${extracted.amount.toLocaleString()} on ${job.reference}.` };
      }
      if (extracted.action === "set-cost") {
        const r = await applySetMoney(scopeJobId, session.officeId, "cost", extracted.amount, extracted.currency);
        if ("error" in r) return { reply: `Couldn't set cost: ${r.error}` };
        return { reply: `Set cost to ${(extracted.currency ?? "USD")} ${extracted.amount.toLocaleString()} on ${job.reference}.` };
      }
      if (extracted.action === "set-quote-line") {
        const r = await applyAddQuoteLine(scopeJobId, session.officeId, extracted);
        if ("error" in r) return { reply: `Couldn't add line: ${r.error}` };
        return { reply: `Added line "${extracted.description}" — ${(extracted.currency ?? "USD")} ${extracted.amount.toLocaleString()} to ${job.reference}'s quote.` };
      }
      if (extracted.action === "delete-job") {
        const r = await applyDeleteJob(scopeJobId, session.officeId);
        if ("error" in r) return { reply: `Couldn't delete: ${r.error}` };
        return { reply: `Deleted ${r.reference}. The kanban board now reflects this.` };
      }
    }
  }

  // Branch 1.45: Award/draft-reply intents — only meaningful when focused on a job.
  if (scopeJobId) {
    const award = detectAwardIntent(userMessage);
    if (award.matched) {
      // Find the inquiry's threads, pick the cheapest priced offer (or matching
      // supplier name if hint present), call awardSupplier.
      const job = await prisma.job.findFirst({
        where: { id: scopeJobId, officeId: session.officeId },
        include: {
          inquiry: { include: { emailThreads: true } },
        },
      });
      if (!job?.inquiry) return { reply: "This job has no linked inquiry to award against." };
      if (job.inquiry.type !== "SOURCING") return { reply: "Award action only applies to procurement (SOURCING) jobs." };

      const candidates = job.inquiry.emailThreads
        .map((t) => {
          let offer: Record<string, unknown> = {};
          try { if (t.supplierOffer) offer = JSON.parse(t.supplierOffer); } catch {}
          return { id: t.id, subject: t.subject, offer };
        });
      let pick = null;
      if (award.supplierHint) {
        const hint = award.supplierHint.toLowerCase();
        pick = candidates.find((c) =>
          (typeof c.offer.supplierName === "string" && (c.offer.supplierName as string).toLowerCase().includes(hint)) ||
          c.subject.toLowerCase().includes(hint)
        );
      }
      if (!pick) {
        // cheapest priced
        pick = candidates
          .filter((c) => typeof c.offer.pricePerUnit === "number")
          .sort((a, b) => (a.offer.pricePerUnit as number) - (b.offer.pricePerUnit as number))[0];
      }
      if (!pick) return { reply: "I can't tell which supplier to award — no offer prices are extracted yet. Open the RFQ and click Award on the supplier you want." };

      const r = await awardSupplier(pick.id);
      if ("error" in r) return { reply: `Couldn't award: ${r.error}` };
      const name = (pick.offer.supplierName as string) || pick.subject;
      return {
        reply: `Awarded the deal to ${name}. Job moved to "Awarded". A confirmation email is drafted — open the RFQ supplier table to copy + send it.\n\n--- Draft preview ---\n${r.emailDraft.slice(0, 600)}${r.emailDraft.length > 600 ? "…" : ""}`,
      };
    }

    if (detectDraftReplyIntent(userMessage)) {
      // Pick the most recent inbound thread on this job's inquiry.
      const job = await prisma.job.findFirst({
        where: { id: scopeJobId, officeId: session.officeId },
        include: { inquiry: { include: { emailThreads: { orderBy: { lastMessageAt: "desc" }, take: 1 } } } },
      });
      const thread = job?.inquiry?.emailThreads?.[0];
      if (!thread) return { reply: "No email threads on this job to reply to." };
      const r = await draftReplyToMessage({ threadId: thread.id, intent: userMessage });
      if ("error" in r) return { reply: `Couldn't draft: ${r.error}` };
      return {
        reply: `Drafted a reply${r.replyTo ? ` to ${r.replyTo}` : ""}:\n\n${r.draft}\n\nCopy from the inbox or RFQ page to send.`,
      };
    }
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

  // Branch 1.9: AI safety-net intent classifier — runs only after every regex
  // intent has missed. Catches phrasings the regexes don't anticipate, so the
  // agent reliably executes verbs instead of hallucinating action results.
  const scopedJob = scopeJobId ? await prisma.job.findFirst({
    where: { id: scopeJobId, officeId: session.officeId },
    select: { id: true, type: true, status: true, reference: true, inquiryId: true },
  }) : null;
  const aiIntent = await classifyAgentIntent({
    userMessage,
    scopeJobId,
    scopeJobType: scopedJob ? (scopedJob.type === "SOURCING" ? "SOURCING" : "FORWARDING") : undefined,
  });

  if (aiIntent.intent === "merge-all-into-one") {
    const r = await mergeAllOpenInquiriesIntoOne({
      type: aiIntent.type,
      subject: aiIntent.subject,
      commodity: aiIntent.commodity,
      origin: aiIntent.origin,
      destination: aiIntent.destination,
      weightKg: aiIntent.weightKg,
    });
    if ("error" in r) return { reply: `Couldn't consolidate: ${r.error}` };
    if (r.mergedCount === 0) return { reply: `Only one open inquiry exists — nothing to merge.` };
    return { reply: `Consolidated ${r.mergedCount + 1} inquiries into one: "${r.subject}". Open the jobs board to confirm or rename.` };
  }
  if (aiIntent.intent === "dedup") {
    const r = await consolidateDuplicateInquiries();
    if ("error" in r) return { reply: `Couldn't dedupe: ${r.error}` };
    if (r.merged === 0) return { reply: "No duplicates found across your open inquiries." };
    return { reply: `Merged ${r.merged} duplicate inquiries into ${r.clusters} cleaned-up deal${r.clusters === 1 ? "" : "s"}.` };
  }
  if (aiIntent.intent === "needs-reply") {
    const cands = await prisma.emailThread.findMany({
      where: { officeId: session.officeId, hiddenAt: null },
      include: { messages: { orderBy: { sentAt: "desc" }, take: 1 }, job: { select: { reference: true } }, inquiry: { select: { subject: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: 80,
    });
    const awaiting = cands.filter((t) => t.messages[0]?.direction === "INBOUND").slice(0, 8);
    if (awaiting.length === 0) return { reply: "Inbox zero — nothing waiting." };
    const lines = awaiting.map((t) => `· "${t.subject}" — ${t.job?.reference ?? t.inquiry?.subject ?? "(unlinked)"} · last from ${t.messages[0].fromName ?? t.messages[0].fromEmail}`);
    return { reply: `${awaiting.length} thread${awaiting.length === 1 ? "" : "s"} awaiting reply:\n\n${lines.join("\n")}` };
  }
  if (aiIntent.intent === "stuck-jobs") {
    const stuck = await findStuckJobs(session.officeId, { daysThreshold: 5, max: 8 });
    if (stuck.length === 0) return { reply: "Pipeline looks healthy — no jobs older than 5 days without activity." };
    const lines = stuck.map((s) => `· ${s.reference} (${s.customer ?? "no customer"}, ${s.daysStuck}d) — ${s.suggestion}`);
    return { reply: `${stuck.length} stuck job${stuck.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}` };
  }
  if (aiIntent.intent === "hide-unrelated") {
    const cands = await prisma.emailThread.findMany({
      where: {
        officeId: session.officeId, hiddenAt: null, jobId: null, inquiryId: null,
        messages: { every: { OR: [{ classification: "OTHER" }, { classification: null }] } },
      },
      take: 100, select: { id: true },
    });
    if (cands.length === 0) return { reply: "No obvious noise threads to hide." };
    await prisma.emailThread.updateMany({ where: { id: { in: cands.map((c) => c.id) } }, data: { hiddenAt: new Date() } });
    revalidatePath("/dashboard/inbox");
    return { reply: `Hid ${cands.length} unrelated thread${cands.length === 1 ? "" : "s"}.` };
  }
  if (aiIntent.intent === "populate-load" && scopeJobId) {
    const r = await populateJobFromEmails(scopeJobId);
    if ("error" in r) return { reply: `Couldn't populate: ${r.error}` };
    if (r.filled.length === 0) return { reply: "Read the linked emails — nothing new to fill." };
    return { reply: `Populated load:\n${r.filled.map((f) => `· ${f}`).join("\n")}` };
  }
  if (aiIntent.intent === "draft-reply" && scopedJob?.inquiryId) {
    const thread = await prisma.emailThread.findFirst({
      where: { inquiryId: scopedJob.inquiryId, officeId: session.officeId },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (!thread) return { reply: "No email threads on this job yet — nothing to reply to." };
    const r = await draftReplyToMessage({ threadId: thread.id, intent: aiIntent.target ?? userMessage });
    if ("error" in r) return { reply: `Couldn't draft: ${r.error}` };
    return { reply: `Drafted a reply${r.replyTo ? ` to ${r.replyTo}` : ""}:\n\n${r.draft}` };
  }
  if (aiIntent.intent === "summarize-offers" && scopedJob?.inquiryId) {
    let inquiry = await prisma.inquiry.findFirst({
      where: { id: scopedJob.inquiryId },
      include: {
        emailThreads: { include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } } },
      },
    });
    if (!inquiry) return { reply: "Couldn't find the linked inquiry." };
    if (inquiry.emailThreads.length === 0) {
      return { reply: "No supplier email threads linked to this procurement job yet. Sync the inbox or link threads from the Inbox page." };
    }

    // If most threads have no parsed offer yet, extract first.
    const parsedCount = inquiry.emailThreads.filter((t) => !!t.supplierOffer).length;
    if (parsedCount < inquiry.emailThreads.length / 2) {
      try {
        await extractSourcingOffersForInquiry(scopedJob.inquiryId);
        // Re-fetch after extraction
        inquiry = await prisma.inquiry.findFirst({
          where: { id: scopedJob.inquiryId },
          include: { emailThreads: { include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } } } },
        });
      } catch { /* keep going with whatever we have */ }
    }

    type OfferRow = {
      supplier: string; price?: number; currency?: string; unit?: string;
      qty?: string; incoterms?: string; payment?: string; lead?: string; valid?: string; origin?: string;
    };
    const rows: OfferRow[] = [];
    for (const t of inquiry?.emailThreads ?? []) {
      let o: any = {};
      if (t.supplierOffer) { try { o = JSON.parse(t.supplierOffer); } catch {} }
      const fallbackName = t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Supplier";
      rows.push({
        supplier: o.supplierName ?? fallbackName,
        price: typeof o.pricePerUnit === "number" ? o.pricePerUnit : undefined,
        currency: o.currency,
        unit: o.unit,
        qty: o.qtyAvailable,
        incoterms: o.incoterms,
        payment: o.paymentTerms,
        lead: o.leadTime,
        valid: o.validity,
        origin: o.origin,
      });
    }
    const priced = rows.filter((r) => r.price != null).sort((a, b) => (a.price! - b.price!));
    const unpriced = rows.filter((r) => r.price == null);

    if (priced.length === 0 && unpriced.length === 0) {
      return { reply: "Threads are linked but no supplier terms parsed yet. Click 'Re-extract with AI' on the procurement RFQ page." };
    }

    const lines: string[] = [];
    lines.push(`${priced.length + unpriced.length} supplier${priced.length + unpriced.length === 1 ? "" : "s"} on this deal — ${inquiry?.commodity ?? "soybean meal"}${inquiry?.destination ? ` to ${inquiry.destination}` : ""}.`);
    lines.push("");
    if (priced.length > 0) {
      lines.push("Ranked by price (cheapest first):");
      priced.forEach((r, i) => {
        const tag = i === 0 ? " ← BEST" : "";
        const priceStr = `${r.currency ?? ""} ${r.price!.toLocaleString()}${r.unit ? `/${r.unit}` : ""}`;
        const meta = [
          r.qty ? `qty ${r.qty}` : null,
          r.incoterms,
          r.origin ? `origin ${r.origin}` : null,
          r.lead ? `lead ${r.lead}` : null,
          r.payment ? `terms ${r.payment}` : null,
        ].filter(Boolean).join(" · ");
        lines.push(`${i + 1}. ${r.supplier} — ${priceStr}${tag}`);
        if (meta) lines.push(`   ${meta}`);
      });
    }
    if (unpriced.length > 0) {
      lines.push("");
      lines.push(`${unpriced.length} supplier${unpriced.length === 1 ? "" : "s"} corresponding but no firm price yet:`);
      unpriced.forEach((r) => lines.push(`· ${r.supplier}${r.lead ? ` (lead ${r.lead})` : ""}`));
    }
    if (priced.length > 0) {
      lines.push("");
      lines.push(`Tell me "award the cheapest" or "go with ${priced[0].supplier}" to lock it in.`);
    }
    return { reply: lines.join("\n") };
  }

  if (aiIntent.intent === "summarize-rates" && scopedJob?.inquiryId) {
    const inquiry = await prisma.inquiry.findFirst({
      where: { id: scopedJob.inquiryId },
      include: { carrierQuotes: { orderBy: { createdAt: "asc" } } },
    });
    if (!inquiry || inquiry.carrierQuotes.length === 0) {
      return { reply: `No carrier rates received yet for ${scopedJob.reference}. The agent watches for replies as they arrive — once a carrier responds, ask again and I'll rank them.` };
    }
    const received = inquiry.carrierQuotes.filter((q) => q.status === "RECEIVED");
    const pending = inquiry.carrierQuotes.filter((q) => q.status !== "RECEIVED");
    const ranked = [...received].sort((a, b) => {
      const ap = a.total40HC ?? a.total40 ?? a.total20 ?? Infinity;
      const bp = b.total40HC ?? b.total40 ?? b.total20 ?? Infinity;
      return ap - bp;
    });
    const lines: string[] = [];
    lines.push(`${ranked.length} carrier rate${ranked.length === 1 ? "" : "s"} received${pending.length ? ` (${pending.length} still pending)` : ""}.`);
    lines.push("");
    ranked.forEach((q, i) => {
      const total = q.total40HC ?? q.total40 ?? q.total20;
      const tag = i === 0 ? " ← BEST" : "";
      lines.push(`${i + 1}. ${q.carrier} — $${(total ?? 0).toLocaleString()} ${q.transitDays ? `· ${q.transitDays}d` : ""}${q.service ? ` · ${q.service}` : ""}${tag}`);
    });
    if (pending.length > 0) {
      lines.push("");
      lines.push(`Pending: ${pending.map((p) => p.carrier).join(", ")}.`);
    }
    return { reply: lines.join("\n") };
  }

  if (aiIntent.intent === "award-supplier" && scopedJob && scopedJob.type === "SOURCING") {
    const inquiry = await prisma.inquiry.findFirst({
      where: { id: scopedJob.inquiryId ?? "" },
      include: { emailThreads: true },
    });
    if (!inquiry) return { reply: "No linked inquiry to award against." };
    const candidates = inquiry.emailThreads.map((t) => {
      let offer: any = {};
      try { if (t.supplierOffer) offer = JSON.parse(t.supplierOffer); } catch {}
      return { id: t.id, subject: t.subject, offer };
    });
    let pick = null;
    if (aiIntent.supplierHint) {
      const hint = aiIntent.supplierHint.toLowerCase();
      pick = candidates.find((c) =>
        (typeof c.offer.supplierName === "string" && c.offer.supplierName.toLowerCase().includes(hint)) ||
        c.subject.toLowerCase().includes(hint)
      );
    }
    if (!pick) {
      pick = candidates.filter((c) => typeof c.offer.pricePerUnit === "number")
        .sort((a, b) => a.offer.pricePerUnit - b.offer.pricePerUnit)[0];
    }
    if (!pick) return { reply: "No supplier prices extracted yet — open the RFQ supplier table to award manually." };
    const r = await awardSupplier(pick.id);
    if ("error" in r) return { reply: `Couldn't award: ${r.error}` };
    const name = pick.offer.supplierName || pick.subject;
    return { reply: `Awarded to ${name}. Job moved to "Awarded" + child forwarding job spun up.\n\n--- Confirmation draft ---\n${r.emailDraft.slice(0, 600)}${r.emailDraft.length > 600 ? "…" : ""}` };
  }

  // Branch 2: Q&A with ops context (optionally scoped to a job)
  const ctx = await buildOpsContext(session.officeId);
  let scopedCtx = "";
  if (scopeJobId) {
    const job = await prisma.job.findFirst({
      where: { id: scopeJobId, officeId: session.officeId },
      include: {
        company: { select: { name: true } },
        inquiry: {
          include: {
            carrierQuotes: true,
            emailThreads: { select: { supplierOffer: true, awardedAt: true, subject: true } },
          },
        },
        documents: true,
        milestones: true,
      },
    });
    if (job) {
      const procurement = job.type === "SOURCING";
      const margin = job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(0)}%` : "—";
      const milestones = job.milestones
        .map((m) => `  - ${m.type}: ${m.actualAt ? `confirmed ${m.actualAt.toISOString().split("T")[0]}` : m.plannedAt ? `planned ${m.plannedAt.toISOString().split("T")[0]}` : "not set"}`)
        .join("\n") || "  (none)";
      const docs = job.documents
        .map((d) => `  - ${d.name}: ${d.status.toLowerCase()}`)
        .join("\n") || "  (none)";

      // For SOURCING jobs, show supplier offers from each linked thread.
      // For FORWARDING, show carrier quotes (existing behavior).
      let quotesBlock: string;
      if (procurement) {
        const offers = (job.inquiry?.emailThreads ?? []).map((t) => {
          let o: any = {};
          if (t.supplierOffer) { try { o = JSON.parse(t.supplierOffer); } catch {} }
          const supplier = o.supplierName ?? t.subject;
          if (o.pricePerUnit != null) {
            return `  - ${supplier}: ${o.currency ?? ""} ${o.pricePerUnit}/${o.unit ?? "unit"} ${o.incoterms ?? ""}${o.qtyAvailable ? ` (qty ${o.qtyAvailable})` : ""}${o.leadTime ? ` lead ${o.leadTime}` : ""}${t.awardedAt ? "  ★ AWARDED" : ""}`;
          }
          return `  - ${supplier}: corresponding, no firm price yet`;
        });
        quotesBlock = `Supplier offers (${offers.length}):\n${offers.join("\n") || "  (none)"}`;
      } else {
        const quotes = job.inquiry?.carrierQuotes
          .map((q) => `  - ${q.carrier}: ${q.status === "RECEIVED" ? `$${(q.total40HC ?? q.total40 ?? q.total20 ?? 0).toLocaleString()}, ${q.transitDays ?? "?"}d` : "pending"}`)
          .join("\n") ?? "  (none)";
        quotesBlock = `Carrier quotes:\n${quotes}`;
      }

      scopedCtx = `

THE USER IS FOCUSED ON THIS JOB. Ground every answer in this job unless they ask about something else.
${procurement ? "This is a PROCUREMENT (SOURCING) job — the office is buying a commodity for the customer. Pricing comes from SUPPLIER OFFERS, NOT carrier quotes." : "This is a FORWARDING job — pricing comes from carrier quotes."}

${job.reference} | ${job.company?.name ?? "no customer"} | ${job.origin ?? "?"} → ${job.destination ?? "?"} | ${job.mode ?? "—"} | ${job.status}
Revenue: ${job.revenue ? `$${job.revenue.toLocaleString()}` : "—"} | Cost: ${job.cost ? `$${job.cost.toLocaleString()}` : "—"} | Margin: ${margin}
ETD: ${job.etd ? job.etd.toISOString().split("T")[0] : "—"} | ETA: ${job.eta ? job.eta.toISOString().split("T")[0] : "—"}
${job.commodity ? `Commodity: ${job.commodity}` : ""}${job.weight ? ` | ${job.weight}kg` : ""}${job.volume ? ` | ${job.volume}cbm` : ""}${job.incoterms ? ` | ${job.incoterms}` : ""}

${quotesBlock}

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
