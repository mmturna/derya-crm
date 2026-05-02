import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReclassifyButton } from "@/components/reclassify-button";

const FILTERS = [
  { key: "",                label: "All" },
  { key: "RFQ",             label: "RFQs" },
  { key: "CARRIER_REPLY",   label: "Carrier reply" },
  { key: "CUSTOMER_REPLY",  label: "Customer reply" },
  { key: "RELATED_NOTE",    label: "Related" },
  { key: "OTHER",           label: "Other" },
  { key: "OUTBOUND",        label: "Sent" },
  { key: "_UNCLASSIFIED",   label: "Unclassified" },
] as const;

const KIND_COLOR: Record<string, { fg: string; bg: string; bd: string; label: string }> = {
  RFQ:             { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "RFQ" },
  CARRIER_REPLY:   { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "Carrier reply" },
  CUSTOMER_REPLY:  { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "Customer reply" },
  RELATED_NOTE:    { fg: "var(--text)",    bg: "var(--surface-3)",    bd: "var(--border-strong)", label: "Related" },
  OTHER:           { fg: "var(--text-3)",  bg: "var(--surface-3)",    bd: "var(--border)",        label: "Other" },
  OUTBOUND:        { fg: "var(--text-2)",  bg: "var(--surface-2)",    bd: "var(--border)",        label: "Sent" },
  UNCLASSIFIED:    { fg: "var(--danger)",  bg: "var(--danger-bg)",    bd: "var(--danger-border)", label: "Unclassified" },
};

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

  const where: any = { account: { officeId: session.officeId } };
  if (accountFilter) where.accountId = accountFilter;
  if (filter === "OUTBOUND") {
    where.direction = "OUTBOUND";
  } else if (filter === "_UNCLASSIFIED") {
    where.direction = "INBOUND";
    where.classification = null;
  } else if (filter) {
    where.direction = "INBOUND";
    where.classification = filter;
  }

  const [messages, counts] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      include: {
        thread: { include: { job: { select: { id: true, reference: true } }, inquiry: { select: { id: true, subject: true } } } },
      },
      orderBy: { sentAt: "desc" },
      take: 80,
    }),
    prisma.emailMessage.groupBy({
      by: ["classification", "direction"],
      where: { account: { officeId: session.officeId } },
      _count: true,
    }),
  ]);

  // Total count per filter button
  function countFor(key: string): number {
    if (!key) return counts.reduce((s, c) => s + c._count, 0);
    if (key === "OUTBOUND") return counts.filter((c) => c.direction === "OUTBOUND").reduce((s, c) => s + c._count, 0);
    if (key === "_UNCLASSIFIED") return counts.filter((c) => c.direction === "INBOUND" && c.classification === null).reduce((s, c) => s + c._count, 0);
    return counts.filter((c) => c.direction === "INBOUND" && c.classification === key).reduce((s, c) => s + c._count, 0);
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Inbox
          </h1>
          <p className="page-subtitle">
            All synced emails from your connected inboxes. Each inbound message gets an AI classification — RFQs become Inquiries, carrier replies update CarrierQuote, customer replies attach to job threads.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ReclassifyButton onlyUnclassified={false} />
          <a href="/dashboard/settings/email" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none" }}>
            Manage inboxes
          </a>
        </div>
      </div>

      {/* Account filter */}
      {accounts.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <a href="/dashboard/inbox" style={{
            padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500,
            background: !accountFilter ? "var(--brand)" : "var(--surface)",
            color: !accountFilter ? "#fff" : "var(--text-2)",
            border: "1px solid", borderColor: !accountFilter ? "var(--brand)" : "var(--border)",
            textDecoration: "none",
          }}>All inboxes</a>
          {accounts.map((a) => (
            <a key={a.id} href={`/dashboard/inbox?account=${a.id}${filter ? `&filter=${filter}` : ""}`} style={{
              padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500,
              background: accountFilter === a.id ? "var(--brand)" : "var(--surface)",
              color: accountFilter === a.id ? "#fff" : "var(--text-2)",
              border: "1px solid", borderColor: accountFilter === a.id ? "var(--brand)" : "var(--border)",
              textDecoration: "none",
            }}>{a.email}</a>
          ))}
        </div>
      )}

      {/* Classification filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          const n = countFor(f.key);
          const accountQs = accountFilter ? `&account=${accountFilter}` : "";
          return (
            <a
              key={f.key}
              href={`/dashboard/inbox?${f.key ? `filter=${f.key}` : ""}${accountQs}`.replace(/^\?&/, "?")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500,
                background: isActive ? "var(--text)" : "var(--surface)",
                color: isActive ? "#fff" : "var(--text-2)",
                border: "1px solid", borderColor: isActive ? "var(--text)" : "var(--border)",
                textDecoration: "none",
              }}
            >
              {f.label}
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: isActive ? "rgba(255,255,255,0.2)" : "var(--surface-3)", color: isActive ? "#fff" : "var(--text-3)" }}>
                {n}
              </span>
            </a>
          );
        })}
      </div>

      {/* Messages list */}
      {messages.length === 0 ? (
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
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No messages match this filter</div>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                Try a different category, or click <em>Sync now</em> in email settings to fetch more.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          {messages.map((m, i) => {
            const kind = m.direction === "OUTBOUND" ? "OUTBOUND" : (m.classification ?? "UNCLASSIFIED");
            const meta = KIND_COLOR[kind] ?? KIND_COLOR.OTHER;
            const linkedJob = m.thread?.job;
            const linkedInquiry = m.thread?.inquiry;
            const detailHref = linkedJob
              ? `/dashboard/jobs/${linkedJob.id}`
              : linkedInquiry
                ? `/dashboard/rfq/${linkedInquiry.id}`
                : null;

            return (
              <div key={m.id} style={{
                display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 14,
                padding: "14px 18px",
                borderBottom: i === messages.length - 1 ? "none" : "1px solid var(--border)",
                alignItems: "flex-start",
              }}>
                {/* Classification + direction */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{
                    display: "inline-flex", alignSelf: "flex-start",
                    fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                    background: meta.bg, color: meta.fg, border: `1px solid ${meta.bd}`,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>{meta.label}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                    {m.direction === "INBOUND" ? "← in" : "→ out"}
                  </span>
                </div>

                {/* Body */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>
                      {m.fromName ?? m.fromEmail}
                    </span>
                    {m.fromName && (
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{m.fromEmail}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 4, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.subject ?? "(no subject)"}
                  </div>
                  {m.bodyText && (
                    <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {m.bodyText.slice(0, 280).replace(/\s+/g, " ").trim()}
                    </div>
                  )}
                  {m.classificationReason && (
                    <div style={{ fontSize: 10.5, color: "var(--text-2)", marginTop: 6, fontStyle: "italic" }}>
                      AI: {m.classificationReason}
                    </div>
                  )}
                  {detailHref && (
                    <a href={detailHref} style={{ display: "inline-block", marginTop: 6, fontSize: 11, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
                      {linkedJob ? `→ ${linkedJob.reference}` : `→ Open RFQ`}
                    </a>
                  )}
                </div>

                {/* Date */}
                <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0, marginTop: 2 }}>
                  {timeAgo(m.sentAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 14, fontSize: 11, color: "var(--text-3)", textAlign: "center" }}>
        Showing the last {messages.length} message{messages.length === 1 ? "" : "s"} matching this filter.
        Older messages aren&apos;t shown but are still stored.
      </p>
    </div>
  );
}
