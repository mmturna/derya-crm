import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";

export type ClassifiedKind = "RFQ" | "CARRIER_REPLY" | "CUSTOMER_REPLY" | "OTHER";

export type Classification =
  | { kind: "RFQ"; subject: string; from: string; parsed: ParsedRFQ }
  | { kind: "CARRIER_REPLY"; matchInquiryId: string | null; parsed: ParsedRate }
  | { kind: "CUSTOMER_REPLY"; matchJobId: string | null; intent: "ACCEPT" | "REJECT" | "CLARIFY" | "OTHER" }
  | { kind: "OTHER"; reason: string };

export type ParsedRFQ = {
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  containerType?: string | null;
  incoterms?: string | null;
  commodity?: string | null;
  weight?: number | null;
  volume?: number | null;
  cargoReadyDate?: string | null;
};

export type ParsedRate = {
  carrier?: string | null;
  total20?: number | null;
  total40?: number | null;
  total40HC?: number | null;
  transitDays?: number | null;
  service?: string | null;
  validity?: string | null;
};

// Quick pattern check before invoking AI — saves tokens on obvious noise.
const FREIGHT_KEYWORDS = /\b(FCL|LCL|RFQ|quote|shipment|container|ETD|ETA|freight|cargo|BL|bill of lading|TEU|shipping|incoterms|EXW|FOB|DAP|DDP|carrier|ocean|airfreight|trucking|customs|booking)\b/i;

export function looksLikeFreightEmail(subject: string, body: string): boolean {
  const sample = (subject + " " + body).slice(0, 1000);
  return FREIGHT_KEYWORDS.test(sample);
}

export async function classifyInboundEmail(args: {
  subject: string;
  fromEmail: string;
  bodyText: string;
  officeId: string;
}): Promise<Classification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "OTHER", reason: "ANTHROPIC_API_KEY missing" };
  if (!looksLikeFreightEmail(args.subject, args.bodyText)) {
    return { kind: "OTHER", reason: "no freight keywords" };
  }

  // Pull a small set of currently-open inquiries + jobs for context (matching purposes)
  const [inquiries, jobs] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: args.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
      select: { id: true, subject: true, fromEmail: true, fromCompany: true, origin: true, destination: true },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    prisma.job.findMany({
      where: { officeId: args.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { id: true, reference: true, origin: true, destination: true, company: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  const inquiryHints = inquiries.map((i) => `${i.id} | "${i.subject}" | from ${i.fromEmail ?? i.fromCompany ?? "?"} | ${i.origin ?? "?"} → ${i.destination ?? "?"}`).join("\n");
  const jobHints = jobs.map((j) => `${j.id} | ${j.reference} | ${j.company?.name ?? "—"} | ${j.origin ?? "?"} → ${j.destination ?? "?"}`).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: `You classify inbound emails for a freight forwarding office. Output ONLY a JSON object matching the spec. No markdown, no commentary.

Schema:
{
  "kind": "RFQ" | "CARRIER_REPLY" | "CUSTOMER_REPLY" | "OTHER",
  // For RFQ: a brand new inbound freight request from a customer
  "parsed": { "origin": string|null, "destination": string|null, "mode": "SEA-FCL"|"SEA-LCL"|"AIR"|"ROAD"|"COURIER"|null, "containerType": "20GP"|"40GP"|"40HC"|"LCL"|null, "incoterms": string|null, "commodity": string|null, "weight": number|null, "volume": number|null, "cargoReadyDate": string|null },
  // For CARRIER_REPLY: a carrier replying to one of OUR rate requests with their offer
  "matchInquiryId": string|null,                 // best-guess inquiry id from OPEN INQUIRIES list
  "rate": { "carrier": string|null, "total20": number|null, "total40": number|null, "total40HC": number|null, "transitDays": number|null, "service": string|null, "validity": string|null },
  // For CUSTOMER_REPLY: a customer responding to one of our quotes
  "matchJobId": string|null,                     // best-guess job id from ACTIVE JOBS list
  "intent": "ACCEPT" | "REJECT" | "CLARIFY" | "OTHER",
  // For OTHER: not a freight RFQ/quote/reply at all
  "reason": string
}

Only include fields relevant to the chosen kind. If unsure between kinds, prefer OTHER.

OPEN INQUIRIES (id | subject | sender | route):
${inquiryHints || "(none)"}

ACTIVE JOBS (id | reference | customer | route):
${jobHints || "(none)"}`,
    messages: [{
      role: "user",
      content: `From: ${args.fromEmail}\nSubject: ${args.subject}\n\n${args.bodyText.slice(0, 3000)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { kind: "OTHER", reason: "AI returned no JSON" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { kind: "OTHER", reason: "AI JSON parse failed" }; }

  switch (parsed.kind) {
    case "RFQ":
      return {
        kind: "RFQ",
        subject: args.subject,
        from: args.fromEmail,
        parsed: parsed.parsed ?? {},
      };
    case "CARRIER_REPLY":
      return {
        kind: "CARRIER_REPLY",
        matchInquiryId: parsed.matchInquiryId ?? null,
        parsed: parsed.rate ?? {},
      };
    case "CUSTOMER_REPLY":
      return {
        kind: "CUSTOMER_REPLY",
        matchJobId: parsed.matchJobId ?? null,
        intent: parsed.intent ?? "OTHER",
      };
    default:
      return { kind: "OTHER", reason: parsed.reason ?? "unclassified" };
  }
}
