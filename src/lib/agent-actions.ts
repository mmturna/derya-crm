"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";

// AI extracts a structured action from a free-form user message when scoped
// to a job. Returns one of:
//   { action: "edit-job", fields: {...} }     — update Job.* fields
//   { action: "move-stage", status: "..." }   — change Job.status
//   { action: "add-milestone", type, plannedAt?, actualAt? }
//   { action: "none" }                        — fall through to chat
//
// We avoid full tool-use plumbing here — single Haiku call returns JSON,
// the caller validates and applies. Cheap and predictable.

type ExtractedAction =
  | { action: "edit-job"; fields: Record<string, unknown> }
  | { action: "move-stage"; status: string }
  | { action: "add-milestone"; type: string; plannedAt?: string; actualAt?: string; note?: string }
  | { action: "none" };

const VALID_STATUSES = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED", "CANCELLED"] as const;
const VALID_MILESTONES = ["BOOKING", "CARGO_READY", "ETD", "ETA", "CUSTOMS_ENTRY", "CUSTOMS_RELEASE", "DELIVERY"] as const;

export async function extractActionFromMessage(args: {
  userMessage: string;
  scopeJobId: string;
  scopeType: "SOURCING" | "FORWARDING";
  scopeStatus: string;
}): Promise<ExtractedAction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { action: "none" };

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 350,
    system: `You parse a single chat message into ONE structured action against the focused freight job. Output ONLY JSON.

Action options:
1. Update Job fields:
   { "action": "edit-job", "fields": { "origin"?: string, "destination"?: string, "mode"?: "SEA-FCL"|"SEA-LCL"|"AIR"|"ROAD"|"COURIER", "incoterms"?: string, "commodity"?: string, "weight"?: number, "volume"?: number, "packages"?: number, "etd"?: "YYYY-MM-DD", "eta"?: "YYYY-MM-DD", "revenue"?: number, "cost"?: number, "currency"?: "USD"|"EUR"|"GBP"|"TRY", "notes"?: string } }

2. Move job to a new stage:
   { "action": "move-stage", "status": "PROPOSED" | "INQUIRY" | "QUOTED" | "BOOKED" | "IN_TRANSIT" | "CUSTOMS" | "DELIVERED" | "CANCELLED" }

3. Add or update a milestone:
   { "action": "add-milestone", "type": "BOOKING"|"CARGO_READY"|"ETD"|"ETA"|"CUSTOMS_ENTRY"|"CUSTOMS_RELEASE"|"DELIVERY", "plannedAt"?: "YYYY-MM-DD", "actualAt"?: "YYYY-MM-DD", "note"?: string }

4. Nothing applicable (the message is a question, ambiguous, or already handled elsewhere):
   { "action": "none" }

Rules:
- Only emit edit-job when there is a CLEAR field assignment ("set ETD May 20", "weight is 18 tons", "the supplier is HONEY", "incoterms CIF").
- Only emit move-stage when the user clearly wants to advance/change the job's lifecycle stage. For SOURCING jobs, "awarded" → BOOKED, "negotiating" → INQUIRY, "received" → DELIVERED.
- "log/mark/note that X happened today" → add-milestone with actualAt set to today's ISO date.
- "ETA confirmed for May 22" or "BL issued today" are milestones (ETA, BOOKING).
- Convert relative dates (today, tomorrow, next week, May 20) to absolute YYYY-MM-DD.
- Convert MT → kg (×1000) for weight.
- For SOURCING type, "supplier" mentions go into notes, NOT origin (origin is the supplier's port/country).
- If unsure or message is conversational, return { "action": "none" }.

Job context:
- type: ${args.scopeType}
- current status: ${args.scopeStatus}
- today: ${new Date().toISOString().split("T")[0]}`,
    messages: [{ role: "user", content: args.userMessage }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { action: "none" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { action: "none" }; }

  if (parsed.action === "edit-job" && parsed.fields && typeof parsed.fields === "object") {
    return { action: "edit-job", fields: parsed.fields };
  }
  if (parsed.action === "move-stage" && (VALID_STATUSES as readonly string[]).includes(parsed.status)) {
    return { action: "move-stage", status: parsed.status };
  }
  if (parsed.action === "add-milestone" && (VALID_MILESTONES as readonly string[]).includes(parsed.type)) {
    return {
      action: "add-milestone",
      type: parsed.type,
      plannedAt: typeof parsed.plannedAt === "string" ? parsed.plannedAt : undefined,
      actualAt: typeof parsed.actualAt === "string" ? parsed.actualAt : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  }
  return { action: "none" };
}

// ── Apply ──────────────────────────────────────────────────────────────────

export async function applyEditJob(jobId: string, officeId: string, fields: Record<string, unknown>): Promise<{ ok: true; applied: string[] }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    select: { id: true, inquiryId: true },
  });
  if (!job) return { ok: true, applied: [] };

  const update: Record<string, unknown> = {};
  const applied: string[] = [];
  const passKey = (k: string, t: "string" | "number" | "date") => {
    const v = fields[k];
    if (v == null || v === "") return;
    if (t === "number") {
      const n = Number(v);
      if (!isNaN(n)) { update[k] = n; applied.push(`${k}=${n}`); }
    } else if (t === "date") {
      const d = new Date(String(v));
      if (!isNaN(d.getTime())) { update[k] = d; applied.push(`${k}=${d.toISOString().split("T")[0]}`); }
    } else {
      update[k] = String(v); applied.push(`${k}=${String(v)}`);
    }
  };
  passKey("origin", "string");
  passKey("destination", "string");
  passKey("mode", "string");
  passKey("incoterms", "string");
  passKey("commodity", "string");
  passKey("weight", "number");
  passKey("volume", "number");
  passKey("packages", "number");
  passKey("revenue", "number");
  passKey("cost", "number");
  passKey("currency", "string");
  passKey("notes", "string");
  passKey("etd", "date");
  passKey("eta", "date");

  if (Object.keys(update).length > 0) {
    await prisma.job.update({ where: { id: jobId }, data: update });
  }
  // Mirror onto inquiry too
  if (job.inquiryId) {
    const inqUpdate: Record<string, unknown> = {};
    for (const k of ["origin", "destination", "mode", "incoterms", "commodity", "weight", "volume"]) {
      if (k in update) inqUpdate[k] = update[k];
    }
    if (Object.keys(inqUpdate).length > 0) {
      await prisma.inquiry.update({ where: { id: job.inquiryId }, data: inqUpdate });
    }
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  return { ok: true, applied };
}

export async function applyMoveStage(jobId: string, officeId: string, status: string): Promise<{ ok: true; from: string; to: string } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true, status: true } });
  if (!job) return { error: "Job not found" };
  await prisma.job.update({ where: { id: jobId }, data: { status: status as never } });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  return { ok: true, from: job.status, to: status };
}

export async function applyAddMilestone(jobId: string, officeId: string, args: { type: string; plannedAt?: string; actualAt?: string; note?: string }): Promise<{ ok: true; type: string } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true } });
  if (!job) return { error: "Job not found" };

  // Upsert by (jobId, type)
  const existing = await prisma.jobMilestone.findFirst({ where: { jobId, type: args.type } });
  const data: Record<string, unknown> = { jobId, type: args.type };
  if (args.plannedAt) {
    const d = new Date(args.plannedAt);
    if (!isNaN(d.getTime())) data.plannedAt = d;
  }
  if (args.actualAt) {
    const d = new Date(args.actualAt);
    if (!isNaN(d.getTime())) data.actualAt = d;
  }
  if (args.note) data.note = args.note;

  if (existing) {
    await prisma.jobMilestone.update({ where: { id: existing.id }, data });
  } else {
    await prisma.jobMilestone.create({ data: data as never });
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true, type: args.type };
}
