"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { getValidAccessToken } from "./gmail-oauth";
import { classifyInboundEmail } from "./email-classifier";

const FETCH_LIMIT = 25; // per sync
const PER_PAGE = 25;

type GmailMessageMeta = { id: string; threadId: string };
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  payload: {
    headers: { name: string; value: string }[];
    parts?: GmailMessage["payload"][];
    body?: { data?: string; size?: number };
    mimeType?: string;
  };
};

function header(headers: { name: string; value: string }[], name: string): string | null {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function decodeBase64Url(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm, "base64").toString("utf-8");
}

function extractPlainBody(payload: GmailMessage["payload"]): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts?.length) {
    for (const p of payload.parts) {
      const t = extractPlainBody(p);
      if (t) return t;
    }
  }
  // Fallback to HTML stripped
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

// Sync the most recent N messages for a given account.
export async function syncEmailAccount(accountId: string): Promise<{ ok: true; processed: number; created: number } | { error: string }> {
  const session = await requireSession();
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, officeId: session.officeId },
  });
  if (!account) return { error: "Account not found" };
  if (account.provider !== "GMAIL") return { error: "Only Gmail sync is implemented" };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(accountId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "token refresh failed" };
  }

  // Fetch most recent message IDs (after lastSyncAt if set)
  // Gmail "after:" query takes a unix timestamp in seconds.
  const afterParam = account.lastSyncAt
    ? `after:${Math.floor(account.lastSyncAt.getTime() / 1000)}`
    : "newer_than:7d"; // first sync = last 7 days
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", afterParam);
  listUrl.searchParams.set("maxResults", String(PER_PAGE));

  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) {
    const t = await listRes.text();
    return { error: `Gmail list failed: ${listRes.status} ${t.slice(0, 200)}` };
  }
  const listJson: { messages?: GmailMessageMeta[] } = await listRes.json();
  const ids = (listJson.messages ?? []).slice(0, FETCH_LIMIT).map((m) => m.id);

  let processed = 0;
  let created = 0;

  for (const id of ids) {
    // Skip if already synced (dedupe by externalId)
    const existing = await prisma.emailMessage.findUnique({ where: { externalId: id } });
    if (existing) continue;

    const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!msgRes.ok) continue;
    const msg: GmailMessage = await msgRes.json();
    processed++;

    const headers = msg.payload.headers;
    const fromRaw = header(headers, "From") ?? "";
    const subject = header(headers, "Subject") ?? "(no subject)";
    const dateStr = header(headers, "Date");
    const messageId = header(headers, "Message-ID");
    const inReplyTo = header(headers, "In-Reply-To");
    const references = header(headers, "References");
    const toRaw = header(headers, "To") ?? "";
    const sentAt = dateStr ? new Date(dateStr) : new Date(parseInt(msg.internalDate));

    // Parse "Name <email@x>" or just "email@x"
    const fromMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/);
    const fromEmail = fromMatch ? fromMatch[1] : fromRaw;
    const fromName = fromRaw.includes("<") ? fromRaw.split("<")[0].trim().replace(/^"|"$/g, "") : null;

    // Determine inbound vs outbound (sender is the connected account itself = outbound)
    const direction = fromEmail.toLowerCase() === account.email.toLowerCase() ? "OUTBOUND" : "INBOUND";

    const body = extractPlainBody(msg.payload);

    // Try to find existing thread by In-Reply-To / References / Subject
    let threadId: string | null = null;

    if (inReplyTo) {
      const parent = await prisma.emailMessage.findFirst({
        where: { externalId: inReplyTo },
        select: { threadId: true },
      });
      if (parent) threadId = parent.threadId;
    }
    if (!threadId && references) {
      const refIds = references.split(/\s+/).filter(Boolean);
      const parent = await prisma.emailMessage.findFirst({
        where: { externalId: { in: refIds } },
        select: { threadId: true },
      });
      if (parent) threadId = parent.threadId;
    }
    if (!threadId) {
      // Match by normalized subject (strip Re:/Fwd:)
      const normSubject = subject.replace(/^\s*(Re|Fwd|FW|RE|FWD):\s*/gi, "").trim();
      if (normSubject) {
        const t = await prisma.emailThread.findFirst({
          where: { officeId: account.officeId, subject: { contains: normSubject } },
          orderBy: { lastMessageAt: "desc" },
        });
        if (t) threadId = t.id;
      }
    }

    // Inbound classification (if no thread match yet)
    let attachJobId: string | null = null;
    let attachInquiryId: string | null = null;
    let classificationLabel: string | null = null;
    if (direction === "INBOUND" && !threadId) {
      try {
        const cls = await classifyInboundEmail({
          subject, fromEmail, bodyText: body, officeId: account.officeId,
        });
        classificationLabel = cls.kind;
        if (cls.kind === "RFQ") {
          // Create new Inquiry
          const inq = await prisma.inquiry.create({
            data: {
              officeId: account.officeId,
              subject,
              fromEmail,
              fromCompany: fromName,
              status: "PARSED",
              rawEmailBody: body.slice(0, 10000),
              parsedData: JSON.stringify(cls.parsed),
              origin: cls.parsed.origin ?? null,
              destination: cls.parsed.destination ?? null,
              mode: cls.parsed.mode ?? null,
              containerType: cls.parsed.containerType ?? null,
              incoterms: cls.parsed.incoterms ?? null,
              commodity: cls.parsed.commodity ?? null,
              weight: cls.parsed.weight ?? null,
              volume: cls.parsed.volume ?? null,
              cargoReadyDate: cls.parsed.cargoReadyDate ? new Date(cls.parsed.cargoReadyDate) : null,
              receivedAt: sentAt,
            },
          });
          attachInquiryId = inq.id;
        } else if (cls.kind === "CARRIER_REPLY" && cls.matchInquiryId) {
          attachInquiryId = cls.matchInquiryId;
          // If rate fields present, upsert a CarrierQuote
          if (cls.parsed.carrier) {
            const existing = await prisma.carrierQuote.findFirst({
              where: { inquiryId: cls.matchInquiryId, carrier: cls.parsed.carrier },
            });
            const data = {
              total20: cls.parsed.total20 ?? null,
              total40: cls.parsed.total40 ?? null,
              total40HC: cls.parsed.total40HC ?? null,
              transitDays: cls.parsed.transitDays ?? null,
              service: cls.parsed.service ?? null,
              validity: cls.parsed.validity ?? null,
              status: "RECEIVED",
            };
            if (existing) {
              await prisma.carrierQuote.update({ where: { id: existing.id }, data });
            } else {
              await prisma.carrierQuote.create({
                data: { inquiryId: cls.matchInquiryId, carrier: cls.parsed.carrier, ...data },
              });
            }
            // Bump inquiry status to PRICED
            await prisma.inquiry.update({
              where: { id: cls.matchInquiryId },
              data: { status: "PRICED" },
            });
          }
        } else if (cls.kind === "CUSTOMER_REPLY" && cls.matchJobId) {
          attachJobId = cls.matchJobId;
        }
      } catch {
        // classification failed; just store as plain message
      }
    }

    // Create / find thread
    let finalThreadId = threadId;
    if (!finalThreadId) {
      const thread = await prisma.emailThread.create({
        data: {
          officeId: account.officeId,
          subject,
          participants: JSON.stringify([fromEmail, account.email]),
          jobId: attachJobId,
          inquiryId: attachInquiryId,
          lastMessageAt: sentAt,
        },
      });
      finalThreadId = thread.id;
    }

    // Create the message
    await prisma.emailMessage.create({
      data: {
        threadId: finalThreadId,
        accountId: account.id,
        externalId: messageId ?? id,
        direction,
        fromEmail,
        fromName,
        toEmails: JSON.stringify(toRaw ? [toRaw] : []),
        subject,
        bodyText: body.slice(0, 50000),
        sentAt,
        classification: classificationLabel,
      },
    });
    await prisma.emailThread.update({
      where: { id: finalThreadId },
      data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
    });
    created++;
  }

  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/settings/email");
  return { ok: true, processed, created };
}

export async function disconnectEmailAccount(accountId: string): Promise<void> {
  const session = await requireSession();
  await prisma.emailAccount.update({
    where: { id: accountId, officeId: session.officeId },
    data: { isActive: false },
  });
  revalidatePath("/dashboard/settings/email");
}
