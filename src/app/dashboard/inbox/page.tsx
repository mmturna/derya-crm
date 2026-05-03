import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReclassifyButton } from "@/components/reclassify-button";
import { CreateInquiryButton } from "@/components/create-inquiry-button";
import { ThreadAccordion } from "@/components/thread-accordion";
import { MergeDuplicatesButton } from "@/components/merge-duplicates-button";
import { InboxQuickReply } from "@/components/inbox-quick-reply";

const FILTERS = [
  { key: "",                label: "All threads" },
  { key: "_UNLINKED",       label: "Unlinked" },
  { key: "_LINKED",         label: "Linked to a load" },
] as const;

function timeAgo(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const KIND_META: Record<string, { fg: string; bg: string; bd: string; label: string }> = {
  RFQ:             { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "RFQ" },
  CARRIER_REPLY:   { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "Carrier reply" },
  CUSTOMER_REPLY:  { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "Customer reply" },
  RELATED_NOTE:    { fg: "var(--text)",    bg: "var(--surface-3)",    bd: "var(--border-strong)", label: "Related" },
  OTHER:           { fg: "var(--text-3)",  bg: "var(--surface-3)",    bd: "var(--border)",        label: "Other" },
  UNCLASSIFIED:    { fg: "var(--danger)",  bg: "var(--danger-bg)",    bd: "var(--danger-border)", label: "Unclassified" },
};

function dominantKind(messages: { direction: string; classification: string | null }[]): string {
  const inbound = messages.filter((m) => m.direction === "INBOUND");
  if (inbound.length === 0) return "OTHER";
  const counts: Record<string, number> = {};
  for (const m of inbound) {
    const k = m.classification ?? "UNCLASSIFIED";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  // Priority: RFQ > CARRIER_REPLY > CUSTOMER_REPLY > RELATED_NOTE > UNCLASSIFIED > OTHER
  for (const k of ["RFQ", "CARRIER_REPLY", "CUSTOMER_REPLY", "RELATED_NOTE", "UNCLASSIFIED", "OTHER"]) {
    if (counts[k] && counts[k] > 0) return k;
  }
  return "OTHER";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; account?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filter = sp.filter ?? "";
  const accountFilter = sp.account ?? "";

  const accounts = await prisma.emailAccount.findMany({
    where: { officeId: session.officeId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  // Threads with messages, plus their linked job/inquiry
  const where: any = { officeId: session.officeId };
  if (filter === "_UNLINKED") {
    where.jobId = null;
    where.inquiryId = null;
  } else if (filter === "_LINKED") {
    where.OR = [{ jobId: { not: null } }, { inquiryId: { not: null } }];
  }
  if (accountFilter) {
    // restrict to threads that have at least one message from this account
    where.messages = { some: { accountId: accountFilter } };
  }

  const threads = await prisma.emailThread.findMany({
    where,
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      job: { select: { id: true, reference: true, type: true, company: { select: { name: true } } } },
      inquiry: { select: { id: true, subject: true, type: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 60,
  });

  // Counts for the filter chips
  const totalUnlinked = await prisma.emailThread.count({
    where: { officeId: session.officeId, jobId: null, inquiryId: null },
  });
  const totalLinked = await prisma.emailThread.count({
    where: { officeId: session.officeId, OR: [{ jobId: { not: null } }, { inquiryId: { not: null } }] },
  });
  const totalAll = totalUnlinked + totalLinked;

  function countFor(key: string): number {
    if (!key) return totalAll;
    if (key === "_UNLINKED") return totalUnlinked;
    if (key === "_LINKED") return totalLinked;
    return 0;
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-subtitle">
            Synced emails grouped by thread. AI links each thread to a load when it can.
            For threads it didn&apos;t link, click <em>Create Inquiry from this thread</em> to spin up
            a load using all the messages as context.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <MergeDuplicatesButton />
          <ReclassifyButton onlyUnclassified={false} />
          <a href="/dashboard/settings/email" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none" }}>
            Manage inboxes
          </a>
        </div>
      </div>

      {accounts.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <a href="/dashboard/inbox" style={chipStyle(!accountFilter)}>All inboxes</a>
          {accounts.map((a) => (
            <a key={a.id} href={`/dashboard/inbox?account=${a.id}${filter ? `&filter=${filter}` : ""}`} style={chipStyle(accountFilter === a.id)}>{a.email}</a>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const accountQs = accountFilter ? `&account=${accountFilter}` : "";
          const isActive = filter === f.key;
          return (
            <a
              key={f.key}
              href={`/dashboard/inbox?${f.key ? `filter=${f.key}` : ""}${accountQs}`.replace(/^\?&/, "?")}
              style={chipStyle(isActive, "dark")}
            >
              {f.label}
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: isActive ? "rgba(255,255,255,0.2)" : "var(--surface-3)", color: isActive ? "#fff" : "var(--text-3)", marginLeft: 6 }}>
                {countFor(f.key)}
              </span>
            </a>
          );
        })}
      </div>

      {threads.length === 0 ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          {accounts.length === 0 ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No inboxes connected</div>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
                Connect a Gmail inbox to start syncing emails.
              </p>
              <a href="/dashboard/settings/email" className="btn" style={{ display: "inline-block", textDecoration: "none" }}>
                Go to email settings
              </a>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>
              No threads match this filter.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {threads.map((t) => {
            const linked = t.job || t.inquiry;
            const kind = dominantKind(t.messages);
            const meta = KIND_META[kind] ?? KIND_META.OTHER;
            const last = t.messages[t.messages.length - 1];
            const inboundCount = t.messages.filter((m) => m.direction === "INBOUND").length;
            const outboundCount = t.messages.length - inboundCount;
            const lastReason = [...t.messages].reverse().find((m) => m.classificationReason)?.classificationReason;

            return (
              <div key={t.id} className="card" style={{ overflow: "hidden", borderLeft: linked ? "3px solid var(--brand)" : "3px solid transparent" }}>
                <div style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{
                      display: "inline-flex", fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                      background: meta.bg, color: meta.fg, border: `1px solid ${meta.bd}`,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                    }}>{meta.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.subject || "(no subject)"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {t.messages.length} msg{t.messages.length === 1 ? "" : "s"}
                      {inboundCount > 0 && outboundCount > 0 ? ` · ${inboundCount} in / ${outboundCount} out` : ""}
                      {" · "}
                      {timeAgo(t.lastMessageAt)}
                    </span>
                  </div>

                  {/* Linked-to / not-linked row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {t.job ? (
                        <a href={`/dashboard/jobs/${t.job.id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
                          → {t.job.reference} {t.job.company?.name ? `· ${t.job.company.name}` : ""}
                          <TypeBadge type={t.job.type} />
                        </a>
                      ) : t.inquiry ? (
                        <a href={`/dashboard/rfq/${t.inquiry.id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
                          → {t.inquiry.subject}
                          <TypeBadge type={t.inquiry.type} />
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
                          Not linked to any load
                        </span>
                      )}
                    </div>
                    <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <InboxQuickReply threadId={t.id} threadSubject={t.subject} />
                      {!linked && (
                        <CreateInquiryButton threadId={t.id} />
                      )}
                    </div>
                  </div>

                  {/* Last message preview + AI reason */}
                  {last && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                        Latest: {last.fromName ?? last.fromEmail} · {timeAgo(last.sentAt)}
                      </div>
                      {last.bodyText && (
                        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {last.bodyText.slice(0, 280).replace(/\s+/g, " ").trim()}
                        </div>
                      )}
                      {lastReason && (
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 6, fontStyle: "italic" }}>
                          AI: {lastReason}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Expandable messages */}
                <ThreadAccordion threadId={t.id} messageCount={t.messages.length} messages={t.messages.map((m) => {
                  let attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
                  if (m.attachments) {
                    try { attachments = JSON.parse(m.attachments); } catch { attachments = []; }
                  }
                  return {
                    id: m.id,
                    direction: m.direction,
                    fromName: m.fromName,
                    fromEmail: m.fromEmail,
                    subject: m.subject,
                    bodyText: m.bodyText,
                    sentAt: m.sentAt.toISOString(),
                    classification: m.classification,
                    gmailMessageId: m.gmailMessageId,
                    attachments,
                  };
                })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isSourcing = type === "SOURCING";
  return (
    <span style={{
      marginLeft: 6, fontSize: 9, fontWeight: 700,
      padding: "1px 5px", borderRadius: 3,
      background: isSourcing ? "var(--surface-3)" : "var(--brand-light)",
      color: isSourcing ? "var(--text-2)" : "var(--brand)",
      border: `1px solid ${isSourcing ? "var(--border-strong)" : "var(--brand-border)"}`,
      textTransform: "uppercase", letterSpacing: "0.06em",
    }}>{isSourcing ? "SOURCING" : "FORWARDING"}</span>
  );
}

function chipStyle(active: boolean, variant: "default" | "dark" = "default"): React.CSSProperties {
  const dark = variant === "dark";
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500,
    background: active ? (dark ? "var(--text)" : "var(--brand)") : "var(--surface)",
    color: active ? "#fff" : "var(--text-2)",
    border: "1px solid", borderColor: active ? (dark ? "var(--text)" : "var(--brand)") : "var(--border)",
    textDecoration: "none",
  };
}
