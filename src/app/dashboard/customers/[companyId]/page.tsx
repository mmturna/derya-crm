import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ActivityType, QuoteResult } from "@prisma/client";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { buildMeetingNote } from "@/lib/assistant";
import { QuickLog } from "@/components/quick-log";
import React from "react";

const STATUS_LABELS: Record<string, string> = {
  UNTOUCHED: "New", IN_PROGRESS: "Talking", WORKED: "Active", LOST: "Lost",
};
const STATUS_COLORS: Record<string, string> = {
  UNTOUCHED: "#b45309", IN_PROGRESS: "#2563eb", WORKED: "#059669", LOST: "#dc2626",
};
const ACTIVITY_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  VISIT:    { label: "Visit",     color: "#059669", bg: "#f0fdf4" },
  CALL:     { label: "Call",      color: "#2563eb", bg: "#eff6ff" },
  EMAIL:    { label: "Email",     color: "#7c3aed", bg: "#f5f3ff" },
  WHATSAPP: { label: "WhatsApp",  color: "#16a34a", bg: "#f0fdf4" },
};
const RESULT_COLOR: Record<string, string> = { WON: "#16a34a", LOST: "#dc2626", PENDING: "#b45309" };
const RESULT_BG:    Record<string, string> = { WON: "#f0fdf4",  LOST: "#fef2f2",  PENDING: "#fffbeb" };
const RESULT_BDR:   Record<string, string> = { WON: "#86efac",  LOST: "#fca5a5",  PENDING: "#fde68a" };
const DOC_LABELS:   Record<string, string> = { contract: "Contract", invoice: "Invoice", proposal: "Proposal", customs: "Customs", other: "Other" };

export default async function CompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  const { companyId } = await params;
  const canViewAll = session.role === "ADMIN" || session.role === "MANAGER" || session.canViewWholeOffice;
  const canManageOwners = session.role === "ADMIN" || session.role === "MANAGER";

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      officeId: session.officeId,
      ...(canViewAll ? {} : { owners: { some: { userId: session.userId } } }),
    },
    include: {
      contacts:  { orderBy: { createdAt: "asc" } },
      owners:    { include: { user: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 30, include: { createdBy: { select: { fullName: true } } } },
      quotes:    { orderBy: { quotedAt: "desc" }, take: 30 },
      shipments: { orderBy: { shipmentDate: "desc" }, take: 20 },
      documents: { orderBy: { createdAt: "desc" } },
      tasks:     { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 20 },
      riskAlerts: { where: { isOpen: true }, orderBy: { createdAt: "desc" }, take: 5 },
      jobs:      { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!company) notFound();

  const users = await prisma.user.findMany({ where: { officeId: session.officeId, isActive: true }, orderBy: { fullName: "asc" } });

  // ── Server actions ────────────────────────────────────────────────────────

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
    const occurredAt = new Date();
    await prisma.activity.create({ data: { officeId: s.officeId, companyId: cid, type, subject, body, audioUrl, occurredAt, createdByUserId: s.userId } });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard");
  }

  async function addQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const origin = String(formData.get("origin") ?? "").trim() || null;
    const destination = String(formData.get("destination") ?? "").trim() || null;
    const mode = String(formData.get("mode") ?? "").trim() || null;
    const valueRaw = String(formData.get("value") ?? "").trim();
    const value = valueRaw ? Number(valueRaw) : null;
    const currency = String(formData.get("currency") ?? "USD").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await prisma.quote.create({ data: { officeId: s.officeId, companyId: cid, result: "PENDING", origin, destination, mode, value: Number.isFinite(value) ? value : null, currency, notes } });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/activity");
  }

  async function resolveQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const quoteId = String(formData.get("quoteId") ?? "");
    const result = String(formData.get("result") ?? "") as QuoteResult;
    const lostReason = result === "LOST" ? (String(formData.get("lostReason") ?? "").trim() || null) : null;
    if (!quoteId || !["WON", "LOST"].includes(result)) return;
    await prisma.quote.updateMany({ where: { id: quoteId, officeId: s.officeId }, data: { result, lostReason } });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard/activity");
  }

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
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  async function addDocumentAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const name = String(formData.get("name") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    const docType = String(formData.get("docType") ?? "other").trim() || "other";
    if (!name || !url) return;
    await prisma.companyDocument.create({ data: { officeId: s.officeId, companyId: cid, name, url, docType, uploadedByUserId: s.userId } });
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  async function deleteDocumentAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const docId = String(formData.get("docId") ?? "");
    await prisma.companyDocument.deleteMany({ where: { id: docId, officeId: s.officeId } });
    revalidatePath(`/dashboard/customers/${companyId}`);
  }

  async function addTaskAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const title = String(formData.get("title") ?? "").trim();
    const dueAtRaw = String(formData.get("dueAt") ?? "").trim();
    const assignedToUserId = String(formData.get("assignedToUserId") ?? "").trim() || null;
    const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
    if (!title) return;
    await prisma.task.create({ data: { officeId: s.officeId, companyId: cid, title, dueAt, assignedToUserId, createdByUserId: s.userId } });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard");
  }

  async function updateTaskStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const taskId = String(formData.get("taskId") ?? "");
    await prisma.task.updateMany({ where: { id: taskId, officeId: s.officeId }, data: { status: "DONE" } });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard");
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
    await prisma.company.update({ where: { id: cid, officeId: s.officeId }, data: { class1, class2, product, lane, direction } });
    revalidatePath(`/dashboard/customers/${cid}`);
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
      await prisma.companyOwner.upsert({ where: { companyId_userId: { companyId: cid, userId } }, update: {}, create: { companyId: cid, userId, isPrimary: idx === 0 && !existingSet.has(userId) } });
    }
    if (ownerIds.length > 0) {
      const primaryOwnerId = ownerIds.includes(primaryOwnerIdRaw) ? primaryOwnerIdRaw : ownerIds[0];
      await prisma.companyOwner.updateMany({ where: { companyId: cid }, data: { isPrimary: false } });
      await prisma.companyOwner.updateMany({ where: { companyId: cid, userId: primaryOwnerId }, data: { isPrimary: true } });
    }
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const lastActivity = company.activities[0]?.occurredAt ?? null;
  const openTasks = company.tasks.filter((t) => t.status === "OPEN");
  const statusColor = STATUS_COLORS[company.status] ?? "#6b7280";
  const fmtShort = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  // ── Layout helpers ────────────────────────────────────────────────────────

  const propRow = (label: string, value: string | null | undefined) =>
    value ? (
      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", textAlign: "right", maxWidth: "60%" }}>{value}</span>
      </div>
    ) : null;

  const sectionHeader = (title: string, count: number, addForm?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-3)" }}>{title}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "var(--surface-3)", color: "var(--text-3)", border: "1px solid var(--border)" }}>{count}</span>
      </div>
      {addForm}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Back */}
      <div style={{ marginBottom: 14 }}>
        <Link href="/dashboard/customers" style={{ fontSize: 13, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 4 }}>← Customers</Link>
      </div>

      {/* ── PROFILE HEADER ─────────────────────────────────────────────── */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "22px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{company.name}</h1>
              <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>
                {STATUS_LABELS[company.status] ?? company.status}
              </span>
              {company.riskAlerts.length > 0 && <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>Risk</span>}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {company.owners.map((o) => (
                <span key={o.userId} style={{ fontSize: 13, fontWeight: o.isPrimary ? 600 : 400, color: o.isPrimary ? "var(--text-2)" : "var(--text-3)" }}>{o.user.fullName}</span>
              ))}
              {lastActivity
                ? <span style={{ fontSize: 13, color: "var(--text-3)" }}>Last contact {fmtShort(lastActivity)}</span>
                : <span style={{ fontSize: 13, color: "#dc2626" }}>Never contacted</span>}
            </div>
          </div>
          {/* Stat chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { n: company.jobs.length,       label: "Jobs" },
              { n: company.quotes.length,    label: "Shipments" },
              { n: company.contacts.length,  label: "Contacts" },
              { n: company.activities.length,label: "Activities" },
              { n: company.documents.length, label: "Docs" },
              { n: openTasks.length,         label: "Open tasks", danger: true },
            ].map((s) => (
              <span key={s.label} style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, background: "var(--surface-3)", border: "1px solid var(--border)", color: s.danger && s.n > 0 ? "#dc2626" : "var(--text-2)" }}>
                {s.n} {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── LOG ACTIVITY BAR ───────────────────────────────────────────── */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
        <QuickLog companyId={company.id} companyName={company.name} action={addActivityAction} />
      </div>

      {/* ── MAIN BODY: left sidebar + right content ─────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "start" }}>

        {/* ── LEFT: Properties sidebar ──────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Company info card */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>About</span>
            </div>
            <div style={{ padding: "4px 16px 12px" }}>
              {propRow("Freight", company.product)}
              {propRow("Direction", company.direction)}
              {propRow("Region", company.lane)}
              {propRow("Class 1", company.class1)}
              {propRow("Class 2", company.class2)}
              {!company.product && !company.direction && !company.lane && (
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "10px 0 0" }}>No details set.</p>
              )}
            </div>
            <details style={{ borderTop: "1px solid var(--border)" }}>
              <summary style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "var(--text-3)", cursor: "pointer", listStyle: "none" }}>Edit details ›</summary>
              <div style={{ padding: "0 16px 16px" }}>
                <form action={updateCompanyDetailsAction} className="field" style={{ marginTop: 10 }}>
                  <input type="hidden" name="companyId" value={company.id} />
                  <select name="class1" defaultValue={company.class1 ?? ""}><option value="">Class 1</option><option value="Passive">Passive</option><option value="Potential">Potential</option><option value="Active">Active</option></select>
                  <select name="class2" defaultValue={company.class2 ?? ""}><option value="">Class 2</option>{["A","B","C","D","E"].map(v => <option key={v} value={v}>{v}</option>)}</select>
                  <select name="product" defaultValue={company.product ?? ""}><option value="">Freight type</option><option value="Sea">Sea</option><option value="Air">Air</option><option value="Road">Road</option><option value="LTL">LTL</option><option value="Project">Project</option></select>
                  <select name="direction" defaultValue={company.direction ?? ""}><option value="">Direction</option><option value="Import">Import</option><option value="Export">Export</option><option value="Both">Both</option></select>
                  <input name="lane" placeholder="Region" defaultValue={company.lane ?? ""} />
                  <button type="submit">Save</button>
                </form>
              </div>
            </details>
          </div>

          {/* Owners card */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>Account owners</span>
            </div>
            <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {company.owners.map((o) => (
                <div key={o.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--brand-light)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {o.user.fullName.split(" ").map(n => n[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{o.user.fullName}</div>
                    {o.isPrimary && <div style={{ fontSize: 10, color: "var(--text-3)" }}>Primary</div>}
                  </div>
                </div>
              ))}
            </div>
            {canManageOwners && (
              <details style={{ borderTop: "1px solid var(--border)" }}>
                <summary style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "var(--text-3)", cursor: "pointer", listStyle: "none" }}>Manage owners ›</summary>
                <div style={{ padding: "0 16px 16px" }}>
                  <form action={updateOwnersAction} className="field" style={{ marginTop: 10 }}>
                    <input type="hidden" name="companyId" value={company.id} />
                    <select name="ownerIds" multiple size={Math.min(4, users.length)} defaultValue={company.owners.map(o => o.userId)}>
                      {users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                    <select name="primaryOwnerId" defaultValue={company.owners.find(o => o.isPrimary)?.userId ?? ""}>
                      <option value="">Primary owner…</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                    <button type="submit">Update</button>
                  </form>
                </div>
              </details>
            )}
          </div>

          {/* Open tasks card */}
          {openTasks.length > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#dc2626" }}>Open reminders</span>
              </div>
              <div style={{ padding: "8px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                {openTasks.map((task) => {
                  const isOverdue = task.dueAt && new Date(task.dueAt) < new Date();
                  return (
                    <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <form action={updateTaskStatusAction} style={{ display: "contents" }}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button type="submit" title="Mark done" style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, padding: 0, border: `2px solid ${isOverdue ? "#dc2626" : "#b45309"}`, background: "transparent", cursor: "pointer" }} />
                      </form>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: isOverdue ? "#dc2626" : "#92400e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</div>
                        {task.dueAt && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{fmtShort(task.dueAt)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <details style={{ borderTop: "1px solid var(--border)" }}>
                <summary style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "var(--text-3)", cursor: "pointer", listStyle: "none" }}>+ Set reminder ›</summary>
                <div style={{ padding: "0 16px 16px" }}>
                  <form action={addTaskAction} className="field" style={{ marginTop: 10 }}>
                    <input type="hidden" name="companyId" value={company.id} />
                    <input name="title" placeholder="What needs to be done?" required />
                    <input type="date" name="dueAt" />
                    <select name="assignedToUserId" defaultValue=""><option value="">Assign to…</option>{users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
                    <button type="submit">Save</button>
                  </form>
                </div>
              </details>
            </div>
          )}

          {/* Set reminder (when no open tasks) */}
          {openTasks.length === 0 && (
            <details style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
              <summary style={{ padding: "12px 16px", fontSize: 12, fontWeight: 600, color: "var(--text-3)", cursor: "pointer", listStyle: "none" }}>+ Set reminder ›</summary>
              <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border)" }}>
                <form action={addTaskAction} className="field" style={{ marginTop: 10 }}>
                  <input type="hidden" name="companyId" value={company.id} />
                  <input name="title" placeholder="What needs to be done?" required />
                  <input type="date" name="dueAt" />
                  <select name="assignedToUserId" defaultValue=""><option value="">Assign to…</option>{users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
                  <button type="submit">Save</button>
                </form>
              </div>
            </details>
          )}

        </div>

        {/* ── RIGHT: Main content ────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* SHIPMENTS */}
          <section>
            {sectionHeader("Shipments", company.quotes.length,
              <details style={{ position: "relative" }}>
                <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "4px 10px", border: "1px solid var(--brand)", borderRadius: 6 }}>+ New quote</summary>
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10, width: 280, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, boxShadow: "var(--shadow-md)" }}>
                  <form action={addQuoteAction} className="field">
                    <input type="hidden" name="companyId" value={company.id} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input name="origin" placeholder="From" />
                      <input name="destination" placeholder="To" />
                    </div>
                    <select name="mode" defaultValue=""><option value="">Freight mode</option><option value="AIR">Air</option><option value="SEA-FCL">Sea FCL</option><option value="SEA-LCL">Sea LCL</option><option value="ROAD">Road</option><option value="COURIER">Courier</option></select>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                      <input name="value" type="number" step="0.01" placeholder="Amount" />
                      <input name="currency" defaultValue="USD" />
                    </div>
                    <input name="notes" placeholder="Notes" />
                    <button type="submit">Save quote</button>
                  </form>
                </div>
              </details>
            )}
            {company.quotes.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No shipment quotes yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {company.quotes.map((q) => (
                  <div key={q.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${RESULT_COLOR[q.result]}`, borderRadius: 8, padding: "12px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {q.origin && q.destination ? <>{q.origin} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>→</span> {q.destination}</> : <span style={{ color: "var(--text-3)", fontWeight: 400 }}>Route not set</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{fmtShort(q.quotedAt)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: RESULT_BG[q.result], color: RESULT_COLOR[q.result], border: `1px solid ${RESULT_BDR[q.result]}` }}>{q.result}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {q.mode && <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 4, background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-2)" }}>{q.mode}</span>}
                      {q.value && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>{q.value.toLocaleString()} {q.currency ?? ""}</span>}
                      {q.notes && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{q.notes}</span>}
                      {q.lostReason && <span style={{ fontSize: 12, color: "#dc2626", fontStyle: "italic" }}>Lost: {q.lostReason}</span>}
                    </div>
                    {q.result === "PENDING" && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Resolve:</span>
                        <form action={resolveQuoteAction} style={{ display: "contents" }}>
                          <input type="hidden" name="quoteId" value={q.id} />
                          <button name="result" value="WON"  type="submit" style={{ fontSize: 12, fontWeight: 600, padding: "4px 14px", borderRadius: 4, cursor: "pointer", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>Won</button>
                          <button name="result" value="LOST" type="submit" style={{ fontSize: 12, fontWeight: 600, padding: "4px 14px", borderRadius: 4, cursor: "pointer", background: "var(--surface)", color: "var(--danger)", border: "1px solid var(--border)" }}>Lost</button>
                        </form>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* JOBS */}
          {company.jobs.length > 0 && (
            <section>
              {sectionHeader("Jobs", company.jobs.length)}
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {company.jobs.map((job) => (
                  <a key={job.id} href={`/dashboard/jobs/${job.id}`} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "11px 0", borderBottom: "1px solid var(--border)",
                    textDecoration: "none", color: "inherit",
                  }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", fontFamily: "ui-monospace, Menlo, monospace" }}>{job.reference}</span>
                        {job.mode && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{job.mode}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {job.origin && job.destination ? `${job.origin} → ${job.destination}` : "Route TBD"}
                        {job.eta ? ` · ETA ${new Date(job.eta).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 3, background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {job.status.replace("_", " ")}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* CONTACTS */}
          <section>
            {sectionHeader("Contacts", company.contacts.length,
              <details style={{ position: "relative" }}>
                <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "4px 10px", border: "1px solid var(--brand)", borderRadius: 6 }}>+ Add</summary>
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10, width: 260, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, boxShadow: "var(--shadow-md)" }}>
                  <form action={addContactAction} className="field">
                    <input type="hidden" name="companyId" value={company.id} />
                    <input name="fullName" required placeholder="Full name" />
                    <input name="title" placeholder="Job title" />
                    <input name="email" type="email" placeholder="Email" />
                    <input name="phone" placeholder="Phone" />
                    <button type="submit">Add contact</button>
                  </form>
                </div>
              </details>
            )}
            {company.contacts.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No contacts added yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {company.contacts.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--brand-light)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {c.fullName.split(" ").map(n => n[0]).slice(0, 2).join("")}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.fullName}</div>
                      {c.title && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{c.title}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                      {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 12, color: "var(--brand)", textDecoration: "none" }}>{c.email}</a>}
                      {c.phone && <span style={{ fontSize: 12, color: "var(--text-3)" }}>{c.phone}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* DOCUMENTS */}
          <section>
            {sectionHeader("Documents", company.documents.length,
              <details style={{ position: "relative" }}>
                <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", cursor: "pointer", listStyle: "none", padding: "4px 10px", border: "1px solid var(--brand)", borderRadius: 6 }}>+ Attach</summary>
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10, width: 260, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, boxShadow: "var(--shadow-md)" }}>
                  <form action={addDocumentAction} className="field">
                    <input type="hidden" name="companyId" value={company.id} />
                    <input name="name" required placeholder="Document name" />
                    <input name="url" type="url" required placeholder="Link (Drive, Dropbox…)" />
                    <select name="docType" defaultValue="other"><option value="contract">Contract</option><option value="invoice">Invoice</option><option value="proposal">Proposal</option><option value="customs">Customs docs</option><option value="other">Other</option></select>
                    <button type="submit">Attach</button>
                  </form>
                </div>
              </details>
            )}
            {company.documents.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No documents attached yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {company.documents.map((doc) => (
                  <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <span style={{ display: "inline-flex" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-3)" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</a>
                      {doc.docType && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{DOC_LABELS[doc.docType] ?? doc.docType}</span>}
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>{fmtShort(doc.createdAt)}</span>
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="docId" value={doc.id} />
                      <button type="submit" title="Remove" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 16, padding: "0 2px" }}>×</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ACTIVITY LOG */}
          <section>
            {sectionHeader("Activity log", company.activities.length)}
            {company.activities.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>No activity logged yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {company.activities.map((item) => {
                  const cfg = ACTIVITY_TYPE_CONFIG[item.type] ?? { label: item.type, color: "#6b7280", bg: "#f9fafb" };
                  return (
                    <div key={item.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${cfg.color}`, borderRadius: 8, padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: item.body ? 6 : 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`, flexShrink: 0 }}>{cfg.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{item.subject ?? "—"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                          {item.createdBy && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{item.createdBy.fullName.split(" ")[0]}</span>}
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{fmtShort(item.occurredAt)}</span>
                        </div>
                      </div>
                      {item.body && <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>{item.body}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
