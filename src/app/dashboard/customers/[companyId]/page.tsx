import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ActivityType, QuoteResult } from "@prisma/client";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { buildEmailDraft, buildMeetingNote } from "@/lib/assistant";
import { QuickLog } from "@/components/quick-log";
import React from "react";

const STATUS_LABELS: Record<string, string> = {
  UNTOUCHED: "New",
  IN_PROGRESS: "Talking",
  WORKED: "Active",
  LOST: "Lost"
};

const STATUS_COLORS: Record<string, string> = {
  UNTOUCHED: "#b45309",
  IN_PROGRESS: "#2563eb",
  WORKED: "#059669",
  LOST: "#dc2626"
};

const ACTIVITY_LABELS: Record<string, string> = {
  VISIT: "Visit",
  CALL: "Call",
  EMAIL: "Email"
};


export default async function CompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  const { companyId } = await params;
  const canViewAll = session.role === "ADMIN" || session.role === "MANAGER" || session.canViewWholeOffice;
  const canManageOwners = session.role === "ADMIN" || session.role === "MANAGER";

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      officeId: session.officeId,
      ...(canViewAll ? {} : { owners: { some: { userId: session.userId } } })
    },
    include: {
      contacts: true,
      owners: { include: { user: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 20 },
      quotes: { orderBy: { quotedAt: "desc" }, take: 20 },
      assignmentChanges: { orderBy: { createdAt: "desc" }, take: 20 },
      tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 20 },
      riskAlerts: { where: { isOpen: true }, orderBy: { createdAt: "desc" }, take: 20 }
    }
  });

  if (!company) notFound();

  const users = await prisma.user.findMany({
    where: { officeId: session.officeId, isActive: true },
    orderBy: { fullName: "asc" }
  });

  const riskAlertHistory = await prisma.riskAlert.findMany({
    where: { companyId, officeId: session.officeId },
    orderBy: { createdAt: "desc" },
    take: 12
  });

  async function addContactAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const title = String(formData.get("title") ?? "").trim() || null;
    if (!fullName) return;
    await prisma.contact.create({ data: { companyId: cid, fullName, email, phone, title } });
    await prisma.event.create({
      data: { officeId: s.officeId, type: "contact.created", entityType: "company", entityId: cid, payload: { fullName, email, phone } }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/customers");
  }

  async function addActivityAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const type = String(formData.get("type") ?? "VISIT") as ActivityType;
    const subject = String(formData.get("subject") ?? "").trim() || null;
    const bodyRaw = String(formData.get("body") ?? "").trim();
    const transcript = String(formData.get("transcript") ?? "").trim();
    const audioUrl = String(formData.get("audioUrl") ?? "").trim() || null;
    const meetingNote = transcript ? await buildMeetingNote(transcript) : null;
    const body = [bodyRaw, meetingNote ? `\n\n${meetingNote}` : ""].join("").trim() || null;
    const occurredAtRaw = String(formData.get("occurredAt") ?? "").trim();
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
    await prisma.activity.create({
      data: { officeId: s.officeId, companyId: cid, type, subject, body, audioUrl, occurredAt, createdByUserId: s.userId }
    });
    await prisma.event.create({
      data: { officeId: s.officeId, type: "activity.created", entityType: "company", entityId: cid, payload: { type, subject, occurredAt: occurredAt.toISOString() } }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard");
  }

  async function addQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const result = String(formData.get("result") ?? "PENDING") as QuoteResult;
    const origin = String(formData.get("origin") ?? "").trim() || null;
    const destination = String(formData.get("destination") ?? "").trim() || null;
    const mode = String(formData.get("mode") ?? "").trim() || null;
    const valueRaw = String(formData.get("value") ?? "").trim();
    const value = valueRaw ? Number(valueRaw) : null;
    const currency = String(formData.get("currency") ?? "").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const lostReason = result === "LOST" ? (String(formData.get("lostReason") ?? "").trim() || null) : null;
    await prisma.quote.create({
      data: { officeId: s.officeId, companyId: cid, result, origin, destination, mode, value: Number.isFinite(value) ? value : null, currency, notes, lostReason }
    });
    await prisma.event.create({
      data: { officeId: s.officeId, type: "quote.created", entityType: "company", entityId: cid, payload: { result, origin, destination, mode, value, currency } }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/activity");
    revalidatePath("/dashboard");
  }

  async function resolveQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const quoteId = String(formData.get("quoteId") ?? "");
    const result = String(formData.get("result") ?? "") as QuoteResult;
    const lostReason = result === "LOST" ? (String(formData.get("lostReason") ?? "").trim() || null) : null;
    if (!quoteId || !["WON", "LOST"].includes(result)) return;
    await prisma.quote.updateMany({
      where: { id: quoteId, officeId: s.officeId },
      data: { result, lostReason }
    });
    await prisma.event.create({
      data: { officeId: s.officeId, type: "quote.resolved", entityType: "company", entityId: companyId, payload: { result, lostReason } }
    });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard/activity");
  }

  async function updateCompanyDetailsAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const class1 = String(formData.get("class1") ?? "").trim() || null;
    const class2 = String(formData.get("class2") ?? "").trim() || null;
    const product = String(formData.get("product") ?? "").trim() || null;
    const lane = String(formData.get("lane") ?? "").trim() || null;
    const direction = String(formData.get("direction") ?? "").trim() || null;
    await prisma.company.update({
      where: { id: cid, officeId: s.officeId },
      data: { class1, class2, product, lane, direction }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  async function createEmailDraftAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const purpose = String(formData.get("purpose") ?? "").trim();
    const context = String(formData.get("context") ?? "").trim();
    const customerName = String(formData.get("customerName") ?? "").trim() || "Customer";
    const draft = await buildEmailDraft({ customerName, purpose, context });
    await prisma.activity.create({
      data: { officeId: s.officeId, companyId: cid, type: "EMAIL", subject: `Draft: ${purpose || "Follow-up"}`, body: draft, createdByUserId: s.userId }
    });
    await prisma.event.create({
      data: { officeId: s.officeId, type: "email.draft.created", entityType: "company", entityId: cid, payload: { purpose } }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard");
  }

  async function updateOwnersAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const ownerIds = formData.getAll("ownerIds").map((v) => String(v));
    const primaryOwnerIdRaw = String(formData.get("primaryOwnerId") ?? "").trim();
    const existing = await prisma.companyOwner.findMany({ where: { companyId: cid }, select: { userId: true } });
    const existingSet = new Set(existing.map((x) => x.userId));
    const nextSet = new Set(ownerIds);
    const removed = existing.filter((x) => !nextSet.has(x.userId)).map((x) => x.userId);
    const added = ownerIds.filter((x) => !existingSet.has(x));
    await prisma.companyOwner.deleteMany({ where: { companyId: cid, userId: { in: removed } } });
    for (const [idx, userId] of added.entries()) {
      await prisma.companyOwner.upsert({
        where: { companyId_userId: { companyId: cid, userId } },
        update: {},
        create: { companyId: cid, userId, isPrimary: idx === 0 && !existingSet.has(userId) }
      });
    }
    if (ownerIds.length > 0) {
      const primaryOwnerId = ownerIds.includes(primaryOwnerIdRaw) ? primaryOwnerIdRaw : ownerIds[0];
      await prisma.companyOwner.updateMany({ where: { companyId: cid }, data: { isPrimary: false } });
      await prisma.companyOwner.updateMany({ where: { companyId: cid, userId: primaryOwnerId }, data: { isPrimary: true } });
    }
    await prisma.assignmentChange.create({
      data: { officeId: s.officeId, companyId: cid, changedByUserId: s.userId, diff: { added, removed, ownerIds } }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/customers");
  }

  async function addTaskAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const title = String(formData.get("title") ?? "").trim();
    const details = String(formData.get("details") ?? "").trim() || null;
    const dueAtRaw = String(formData.get("dueAt") ?? "").trim();
    const assignedToUserId = String(formData.get("assignedToUserId") ?? "").trim() || null;
    const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
    if (!title) return;
    await prisma.task.create({
      data: { officeId: s.officeId, companyId: cid, title, details, dueAt, assignedToUserId, createdByUserId: s.userId }
    });
    await prisma.event.create({
      data: { officeId: s.officeId, type: "task.created", entityType: "company", entityId: cid, payload: { title, dueAt } }
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard");
  }

  async function updateTaskStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const taskId = String(formData.get("taskId") ?? "");
    const nextStatus = String(formData.get("nextStatus") ?? "DONE");
    await prisma.task.updateMany({
      where: { id: taskId, officeId: s.officeId },
      data: { status: nextStatus as "OPEN" | "DONE" | "CANCELLED" }
    });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard");
  }

  const primaryOwner = company.owners.find((o) => o.isPrimary) ?? company.owners[0];
  const lastActivity = company.activities[0]?.occurredAt ?? null;
  const openRiskCount = company.riskAlerts.length;
  const openTasks = company.tasks.filter((t) => t.status === "OPEN");
  const statusColor = STATUS_COLORS[company.status] ?? "var(--text-3)";

  // Sorted activity log (calls, emails, visits only)
  const activityLog = [...company.activities].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  // Shipments = all quotes, newest first
  const shipments = [...company.quotes].sort(
    (a, b) => new Date(b.quotedAt).getTime() - new Date(a.quotedAt).getTime()
  );

  const RESULT_COLOR: Record<string, string> = {
    WON: "var(--success)",
    LOST: "var(--danger)",
    PENDING: "var(--warning)",
  };
  const RESULT_BG: Record<string, string> = {
    WON: "var(--success-bg)",
    LOST: "var(--danger-bg)",
    PENDING: "var(--warning-bg)",
  };
  const RESULT_BORDER: Record<string, string> = {
    WON: "var(--success-border)",
    LOST: "var(--danger-border)",
    PENDING: "var(--warning-border)",
  };

  function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)" }}>
          {children}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "var(--surface-3)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
            {count}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link href="/dashboard/customers" style={{ fontSize: 13, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          ← Customers
        </Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>{company.name}</h1>
          <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>
            {STATUS_LABELS[company.status] ?? company.status}
          </span>
          {openRiskCount > 0 && (
            <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>⚠ Risk flagged</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {company.owners.map((o) => (
            <span key={o.userId} style={{ fontSize: 13, color: o.isPrimary ? "var(--text-2)" : "var(--text-3)", fontWeight: o.isPrimary ? 600 : 400 }}>
              {o.user.fullName}
            </span>
          ))}
          {lastActivity ? (
            <span style={{ fontSize: 13, color: "var(--text-3)" }}>
              Last contact {new Date(lastActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--danger)" }}>Never contacted</span>
          )}
        </div>
      </div>

      {/* 2-col layout */}
      <div className="detail-layout">

        {/* ── Left: sections ────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

          {/* Open reminders */}
          {openTasks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {openTasks.map((task) => {
                const isOverdue = task.dueAt && new Date(task.dueAt) < new Date();
                return (
                  <div key={task.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px",
                    background: isOverdue ? "var(--danger-bg)" : "var(--warning-bg)",
                    border: `1px solid ${isOverdue ? "var(--danger-border)" : "var(--warning-border)"}`,
                    borderRadius: 8,
                  }}>
                    <form action={updateTaskStatusAction} style={{ display: "contents" }}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="nextStatus" value="DONE" />
                      <button type="submit" title="Mark done" style={{
                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0, padding: 0,
                        border: `2px solid ${isOverdue ? "var(--danger)" : "var(--warning)"}`,
                        background: "transparent", cursor: "pointer",
                      }} />
                    </form>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isOverdue ? "var(--danger)" : "var(--warning)" }}>
                      {task.title}
                    </span>
                    {task.dueAt && (
                      <span style={{ fontSize: 11, color: isOverdue ? "var(--danger)" : "var(--warning)", fontWeight: 600 }}>
                        {new Date(task.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Visit & contact history */}
          <section>
            <SectionHeading count={activityLog.length}>Visit history</SectionHeading>
            {activityLog.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No contacts logged yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {activityLog.map((item, i) => (
                  <div key={item.id} style={{ display: "flex", gap: 14, paddingBottom: 18 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 3 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", flexShrink: 0 }} />
                      {i < activityLog.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: "var(--border)", marginTop: 4 }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                          {ACTIVITY_LABELS[item.type] ?? item.type}
                          {item.subject ? ` — ${item.subject}` : ""}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", flexShrink: 0 }}>
                          {new Date(item.occurredAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                      {item.body && (
                        <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>{item.body}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Contacts */}
          <section>
            <SectionHeading count={company.contacts.length}>Contacts</SectionHeading>
            {company.contacts.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No contacts added yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {company.contacts.map((c) => (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "center", gap: 16,
                    padding: "10px 14px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.fullName}</div>
                      {c.title && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{c.title}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                      {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 12, color: "var(--brand)" }}>{c.email}</a>}
                      {c.phone && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{c.phone}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Shipments (quotes) */}
          <section>
            <SectionHeading count={shipments.length}>Shipments</SectionHeading>
            {shipments.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No shipment quotes yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {shipments.map((q) => (
                  <div key={q.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {q.origin && q.destination ? `${q.origin} → ${q.destination}` : "Route not specified"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, display: "flex", gap: 8 }}>
                        {q.mode && <span>{q.mode}</span>}
                        {q.value && <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{q.value.toLocaleString()} {q.currency ?? ""}</span>}
                        {q.notes && <span>{q.notes}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {new Date(q.quotedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                        background: RESULT_BG[q.result] ?? "var(--surface-3)",
                        color: RESULT_COLOR[q.result] ?? "var(--text-3)",
                        border: `1px solid ${RESULT_BORDER[q.result] ?? "var(--border)"}`,
                      }}>
                        {q.result}
                      </span>
                      {q.result === "PENDING" && (
                        <form action={resolveQuoteAction} style={{ display: "flex", gap: 4 }}>
                          <input type="hidden" name="quoteId" value={q.id} />
                          <button name="result" value="WON" type="submit" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", cursor: "pointer" }}>Won</button>
                          <button name="result" value="LOST" type="submit" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)", cursor: "pointer" }}>Lost</button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>

        {/* ── Right: actions ───────────────────────────────── */}
        <div className="detail-sticky-col">

          {/* Quick log */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 8 }}>
            <QuickLog companyId={company.id} companyName={company.name} action={addActivityAction} />
          </div>

          {/* Collapsibles */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>

            <details style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <summary style={{ padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>New shipment quote</span>
              </summary>
              <div style={{ borderTop: "1px solid var(--border)", padding: 14 }}>
                <form action={addQuoteAction} className="field">
                  <input type="hidden" name="companyId" value={company.id} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input name="origin" placeholder="From" />
                    <input name="destination" placeholder="To" />
                  </div>
                  <select name="mode" defaultValue="">
                    <option value="">Mode (optional)</option>
                    <option value="AIR">Air</option>
                    <option value="SEA-FCL">Sea FCL</option>
                    <option value="SEA-LCL">Sea LCL</option>
                    <option value="ROAD">Road</option>
                    <option value="COURIER">Courier</option>
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                    <input name="value" type="number" step="0.01" placeholder="Amount" />
                    <input name="currency" defaultValue="USD" />
                  </div>
                  <input type="hidden" name="result" value="PENDING" />
                  <button type="submit">Save</button>
                </form>
              </div>
            </details>

            <details style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <summary style={{ padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Set reminder</span>
              </summary>
              <div style={{ borderTop: "1px solid var(--border)", padding: 14 }}>
                <form action={addTaskAction} className="field">
                  <input type="hidden" name="companyId" value={company.id} />
                  <input name="title" placeholder="What needs to be done?" required />
                  <input type="date" name="dueAt" />
                  <select name="assignedToUserId" defaultValue="">
                    <option value="">Assign to…</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName}</option>
                    ))}
                  </select>
                  <button type="submit">Save</button>
                </form>
              </div>
            </details>

            <details style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <summary style={{ padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Add contact</span>
              </summary>
              <div style={{ borderTop: "1px solid var(--border)", padding: 14 }}>
                <form action={addContactAction} className="field">
                  <input type="hidden" name="companyId" value={company.id} />
                  <input name="fullName" required placeholder="Full name" />
                  <input name="title" placeholder="Job title" />
                  <input name="email" type="email" placeholder="Email" />
                  <input name="phone" placeholder="Phone" />
                  <button type="submit">Add</button>
                </form>
              </div>
            </details>

            <details style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <summary style={{ padding: "10px 14px", cursor: "pointer", fontWeight: 500, fontSize: 13, color: "var(--text-3)", listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Company details</span>
              </summary>
              <div style={{ borderTop: "1px solid var(--border)", padding: 14 }}>
                <form action={updateCompanyDetailsAction} className="field">
                  <input type="hidden" name="companyId" value={company.id} />
                  <select name="class1" defaultValue={company.class1 ?? ""}>
                    <option value="">Class 1</option>
                    <option value="Passive">Passive</option>
                    <option value="Potential">Potential</option>
                    <option value="Active">Active</option>
                  </select>
                  <select name="class2" defaultValue={company.class2 ?? ""}>
                    <option value="">Class 2</option>
                    {["A", "B", "C", "D", "E"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <select name="product" defaultValue={company.product ?? ""}>
                    <option value="">Freight type</option>
                    <option value="Sea">Sea</option>
                    <option value="Air">Air</option>
                    <option value="Road">Road</option>
                    <option value="LTL">LTL</option>
                    <option value="Project">Project</option>
                  </select>
                  <select name="direction" defaultValue={company.direction ?? ""}>
                    <option value="">Direction</option>
                    <option value="Import">Import</option>
                    <option value="Export">Export</option>
                    <option value="Both">Both</option>
                  </select>
                  <input name="lane" placeholder="Region" defaultValue={company.lane ?? ""} />
                  <button type="submit">Save</button>
                </form>
                {canManageOwners && (
                  <form action={updateOwnersAction} className="field" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
                    <input type="hidden" name="companyId" value={company.id} />
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Owners</div>
                    <select name="ownerIds" multiple size={Math.min(4, users.length)} defaultValue={company.owners.map((o) => o.userId)}>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                    </select>
                    <select name="primaryOwnerId" defaultValue={company.owners.find((o) => o.isPrimary)?.userId ?? ""}>
                      <option value="">Primary owner…</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                    </select>
                    <button type="submit">Update</button>
                  </form>
                )}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
