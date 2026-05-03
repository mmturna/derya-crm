"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { getValidAccessToken } from "./gmail-oauth";

// Send a reply on an existing thread. The reply is threaded properly via
// In-Reply-To/References + the Gmail threadId so it lands inside the original
// conversation in both Gmail and our inbox view.
//
// Scope required on the account: https://www.googleapis.com/auth/gmail.send.
// If the user authorized the inbox before that scope was added, the send call
// returns 403 — the UI catches this and prompts them to reconnect.
export async function sendReplyToThread(args: {
  threadDbId: string;
  body: string;
  replyTo?: string;        // optional override; defaults to the most recent inbound message's fromEmail
  subject?: string;        // optional override; defaults to "Re: <thread.subject>"
}): Promise<{ ok: true; messageId: string } | { error: string; needsReauth?: boolean }> {
  const session = await requireSession();
  const thread = await prisma.emailThread.findFirst({
    where: { id: args.threadDbId, officeId: session.officeId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
    },
  });
  if (!thread) return { error: "Thread not found" };
  if (!thread.externalThreadId) return { error: "Thread is not linked to a Gmail thread (was it synced?)" };

  // Pick the account: the EmailAccount of any message on this thread.
  const acct = thread.messages.find((m) => m.accountId)?.accountId;
  if (!acct) return { error: "No account associated with this thread" };

  const account = await prisma.emailAccount.findFirst({
    where: { id: acct, officeId: session.officeId },
  });
  if (!account) return { error: "Email account not found" };
  if (account.provider !== "GMAIL") return { error: "Only Gmail send is supported" };

  let token: string;
  try {
    token = await getValidAccessToken(account.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "token error" };
  }

  // Build To: address. Default to the latest INBOUND sender.
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "INBOUND");
  const toAddress = args.replyTo ?? lastInbound?.fromEmail ?? thread.messages[0]?.fromEmail;
  if (!toAddress) return { error: "Could not determine recipient" };

  const baseSubject = args.subject ?? thread.subject ?? "(no subject)";
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

  // Build References / In-Reply-To from the most recent message that has a Message-ID.
  const refs = thread.messages
    .filter((m) => m.externalId && m.externalId.startsWith("<"))
    .map((m) => m.externalId!)
    .slice(-10);
  const inReplyTo = refs[refs.length - 1] ?? null;

  const headers: string[] = [
    `From: ${account.email}`,
    `To: ${toAddress}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (refs.length) headers.push(`References: ${refs.join(" ")}`);

  const raw = headers.join("\r\n") + "\r\n\r\n" + args.body;
  const encoded = Buffer.from(raw, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded, threadId: thread.externalThreadId }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 || /insufficient.*scope|insufficient_scope|permission/i.test(body)) {
      return {
        error: "Gmail send scope not granted. Reconnect this inbox in Email Settings to allow sending.",
        needsReauth: true,
      };
    }
    return { error: `Gmail send failed: ${res.status} ${body.slice(0, 200)}` };
  }

  const sent: { id: string; threadId: string } = await res.json();

  // Persist locally as an OUTBOUND EmailMessage so the thread reflects it
  // immediately (without waiting for the next sync).
  await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId: account.id,
      gmailMessageId: sent.id,
      direction: "OUTBOUND",
      fromEmail: account.email,
      fromName: null,
      toEmails: JSON.stringify([toAddress]),
      subject,
      bodyText: args.body,
      sentAt: new Date(),
    },
  });
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
  });

  revalidatePath("/dashboard/inbox");
  if (thread.inquiryId) revalidatePath(`/dashboard/rfq/${thread.inquiryId}`);
  if (thread.jobId) revalidatePath(`/dashboard/jobs/${thread.jobId}`);
  return { ok: true, messageId: sent.id };
}
