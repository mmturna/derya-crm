import { CategoryType, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Badge } from "@/components/ui";

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  CLASS1: "Class 1",
  CLASS2: "Class 2",
  PRODUCT: "Product",
  LANE: "Lane"
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  if (session.role !== UserRole.ADMIN && session.role !== UserRole.MANAGER) {
    redirect("/dashboard");
  }

  const { tab = "team" } = await searchParams;
  const isAdmin = session.role === UserRole.ADMIN;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [users, companyOwners, recentActivities, openTasks, pendingQuotes, categories] = await Promise.all([
    prisma.user.findMany({
      where: { officeId: session.officeId, isActive: true },
      orderBy: { fullName: "asc" }
    }),
    prisma.companyOwner.findMany({
      where: { company: { officeId: session.officeId } },
      select: { userId: true, isPrimary: true, companyId: true }
    }),
    prisma.activity.findMany({
      where: { officeId: session.officeId, occurredAt: { gte: sevenDaysAgo } },
      select: { createdByUserId: true, type: true }
    }),
    prisma.task.findMany({
      where: { officeId: session.officeId, status: "OPEN" },
      select: { assignedToUserId: true, dueAt: true }
    }),
    prisma.quote.findMany({
      where: { officeId: session.officeId, result: "PENDING" },
      select: { companyId: true }
    }),
    prisma.categoryOption.findMany({
      where: { officeId: session.officeId },
      orderBy: [{ type: "asc" }, { value: "asc" }]
    })
  ]);

  // ── Unassigned companies ──────────────────────────────────────
  const assignedCompanyIds = new Set(companyOwners.map((o) => o.companyId));
  const unassignedCompanies = await prisma.company.findMany({
    where: { officeId: session.officeId, id: { notIn: Array.from(assignedCompanyIds) } },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
    take: 50,
  });

  // ── Per-user stats ────────────────────────────────────────────
  const pendingCompanyIds = new Set(pendingQuotes.map((q) => q.companyId));
  const now = new Date();

  const salesPeople = users.filter((u) => u.role === "SALES");
  const teamStats = users.map((u) => {
    const owned = companyOwners.filter((o) => o.userId === u.id);
    const primary = owned.filter((o) => o.isPrimary).length;
    const activityCount = recentActivities.filter((a) => a.createdByUserId === u.id).length;
    const myTasks = openTasks.filter((t) => t.assignedToUserId === u.id);
    const overdueTasks = myTasks.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;
    const myCompanyIds = new Set(owned.map((o) => o.companyId));
    const myPendingQuotes = Array.from(pendingCompanyIds).filter((cid) => myCompanyIds.has(cid)).length;
    return {
      ...u,
      accountCount: primary,
      activityCount7d: activityCount,
      openTaskCount: myTasks.length,
      overdueTaskCount: overdueTasks,
      pendingQuoteCount: myPendingQuotes,
    };
  }).filter((u) => u.role !== "ADMIN" || u.id === session.userId);

  // ── Server actions ────────────────────────────────────────────

  async function assignCompanyAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const companyId = String(formData.get("companyId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    if (!companyId || !userId) return;
    await prisma.companyOwner.upsert({
      where: { companyId_userId: { companyId, userId } },
      update: { isPrimary: true },
      create: { companyId, userId, isPrimary: true }
    });
    await prisma.assignmentChange.create({
      data: { officeId: s.officeId, companyId, changedByUserId: s.userId, diff: { type: "assign", userId } }
    });
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function reassignCompaniesAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const fromUserId = String(formData.get("fromUserId") ?? "");
    const toUserId = String(formData.get("toUserId") ?? "");
    if (!fromUserId || !toUserId || fromUserId === toUserId) return;
    // Find all primary companies owned by fromUser
    const owned = await prisma.companyOwner.findMany({
      where: { userId: fromUserId, isPrimary: true, company: { officeId: s.officeId } },
      select: { companyId: true }
    });
    for (const { companyId } of owned) {
      await prisma.companyOwner.upsert({
        where: { companyId_userId: { companyId, userId: toUserId } },
        update: { isPrimary: true },
        create: { companyId, userId: toUserId, isPrimary: true }
      });
      await prisma.companyOwner.updateMany({
        where: { companyId, userId: fromUserId },
        data: { isPrimary: false }
      });
    }
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function toggleUserVisibilityAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN) return;
    const userId = String(formData.get("userId") ?? "");
    const nextValue = String(formData.get("canViewWholeOffice") ?? "") === "true";
    await prisma.user.update({ where: { id: userId }, data: { canViewWholeOffice: nextValue } });
    revalidatePath("/dashboard/admin");
  }

  async function addCategoryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN) return;
    const type = String(formData.get("type") ?? "CLASS1") as CategoryType;
    const value = String(formData.get("value") ?? "").trim();
    if (!value) return;
    await prisma.categoryOption.upsert({
      where: { officeId_type_value: { officeId: s.officeId, type, value } },
      update: { isActive: true },
      create: { officeId: s.officeId, type, value, isActive: true }
    });
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function toggleCategoryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN) return;
    const id = String(formData.get("id") ?? "");
    const isActive = String(formData.get("isActive") ?? "") === "true";
    await prisma.categoryOption.update({ where: { id }, data: { isActive } });
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  const categoryGroups = Object.values(CategoryType).reduce<Record<string, typeof categories>>((acc, type) => {
    acc[type] = categories.filter((c) => c.type === type);
    return acc;
  }, {} as Record<string, typeof categories>);

  const salesUsers = users.filter((u) => u.role === "SALES");

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">{salesPeople.length} sales reps · {companyOwners.filter((o) => o.isPrimary).length} accounts assigned</p>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 6 }}>
            <Link href="/dashboard/admin?tab=team">
              <button type="button" className={tab === "team" ? "btn-sm" : "secondary btn-sm"}>Team overview</button>
            </Link>
            <Link href="/dashboard/admin?tab=settings">
              <button type="button" className={tab === "settings" ? "btn-sm" : "secondary btn-sm"}>Settings</button>
            </Link>
          </div>
        )}
      </div>

      {/* ── TEAM TAB ──────────────────────────────────────────────── */}
      {(tab === "team" || !isAdmin) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Per-rep stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {teamStats.map((u) => {
              const initials = u.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              const activityLevel = u.activityCount7d >= 10 ? "good" : u.activityCount7d >= 4 ? "warn" : "danger";
              return (
                <div key={u.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--brand-light)", border: "1px solid var(--brand-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--brand)", flexShrink: 0 }}>
                      {initials}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{u.fullName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "capitalize" }}>{u.role.toLowerCase()}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <StatCell label="Accounts" value={u.accountCount} />
                    <StatCell label="Activities (7d)" value={u.activityCount7d} tone={activityLevel} />
                    <StatCell label="Open tasks" value={u.openTaskCount} tone={u.overdueTaskCount > 0 ? "danger" : "default"} sub={u.overdueTaskCount > 0 ? `${u.overdueTaskCount} overdue` : undefined} />
                    <StatCell label="Pending quotes" value={u.pendingQuoteCount} tone={u.pendingQuoteCount > 3 ? "warn" : "default"} />
                  </div>
                  <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                    <Link href={`/dashboard/customers?ownerId=${u.id}`} style={{ flex: 1 }}>
                      <button type="button" className="secondary btn-sm" style={{ width: "100%", fontSize: 11 }}>View accounts</button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity table — who did what this week */}
          <div className="card">
            <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="section-title">Activity this week</div>
            </div>
            <div className="table-wrap">
              <table style={{ border: "none", borderRadius: 0 }}>
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th>Accounts</th>
                    <th style={{ textAlign: "right" }}>Calls</th>
                    <th style={{ textAlign: "right" }}>Visits</th>
                    <th style={{ textAlign: "right" }}>Emails</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th style={{ textAlign: "right" }}>Open tasks</th>
                    <th style={{ textAlign: "right" }}>Pending quotes</th>
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map((u) => {
                    const myActivities = recentActivities.filter((a) => a.createdByUserId === u.id);
                    const calls = myActivities.filter((a) => a.type === "CALL").length;
                    const visits = myActivities.filter((a) => a.type === "VISIT").length;
                    const emails = myActivities.filter((a) => a.type === "EMAIL").length;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.fullName}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{u.email}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>{u.accountCount}</td>
                        <td style={{ textAlign: "right", fontSize: 13 }}>{calls}</td>
                        <td style={{ textAlign: "right", fontSize: 13 }}>{visits}</td>
                        <td style={{ textAlign: "right", fontSize: 13 }}>{emails}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13, color: u.activityCount7d === 0 ? "var(--danger)" : "var(--text)" }}>
                          {u.activityCount7d}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 13, color: u.overdueTaskCount > 0 ? "var(--danger)" : "var(--text-2)", fontWeight: u.overdueTaskCount > 0 ? 700 : 400 }}>
                          {u.openTaskCount}{u.overdueTaskCount > 0 ? ` (${u.overdueTaskCount} late)` : ""}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 13, color: u.pendingQuoteCount > 0 ? "var(--warning)" : "var(--text-2)" }}>
                          {u.pendingQuoteCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Unassigned companies */}
          {unassignedCompanies.length > 0 && (
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="section-title">Unassigned accounts</div>
                  <Badge tone="warn">{unassignedCompanies.length}</Badge>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>These companies have no owner — assign them to a rep.</p>
              </div>
              <div className="table-wrap">
                <table style={{ border: "none", borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Assign to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassignedCompanies.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/dashboard/customers/${c.id}`} style={{ fontWeight: 600, color: "var(--brand)", fontSize: 13 }}>{c.name}</Link>
                        </td>
                        <td>
                          <Badge tone={c.status === "WORKED" ? "good" : c.status === "IN_PROGRESS" ? "info" : c.status === "LOST" ? "danger" : "neutral"}>
                            {c.status.replace("_", " ")}
                          </Badge>
                        </td>
                        <td>
                          <form action={assignCompanyAction} style={{ display: "flex", gap: 6 }}>
                            <input type="hidden" name="companyId" value={c.id} />
                            <select name="userId" style={{ fontSize: 12, height: 28, padding: "0 6px" }}>
                              <option value="">Select rep…</option>
                              {salesUsers.map((u) => (
                                <option key={u.id} value={u.id}>{u.fullName}</option>
                              ))}
                            </select>
                            <button type="submit" className="btn-sm" style={{ height: 28, fontSize: 11 }}>Assign</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Reassign bulk */}
          {isAdmin && salesUsers.length >= 2 && (
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="section-title">Reassign accounts</div>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Move all primary accounts from one rep to another — e.g. when someone leaves.</p>
              </div>
              <div className="card-body">
                <ReassignForm users={salesUsers} action={reassignCompaniesAction} companyOwners={companyOwners} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS TAB ──────────────────────────────────────────── */}
      {tab === "settings" && isAdmin && (
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20, alignItems: "flex-start" }}>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="section-title" style={{ marginBottom: 4 }}>User permissions</div>
                <p style={{ fontSize: 13, color: "var(--text-3)" }}>Toggle between own-accounts-only and whole-office access per user.</p>
              </div>
              <div className="table-wrap">
                <table style={{ border: "none", borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Access</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{user.fullName}</div>
                          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{user.email}</div>
                        </td>
                        <td><Badge tone="info">{user.role}</Badge></td>
                        <td>
                          {user.canViewWholeOffice
                            ? <Badge tone="good">Whole office</Badge>
                            : <Badge tone="neutral">Own accounts</Badge>}
                        </td>
                        <td>
                          <form action={toggleUserVisibilityAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="canViewWholeOffice" value={user.canViewWholeOffice ? "false" : "true"} />
                            <button type="submit" className="secondary btn-sm">
                              {user.canViewWholeOffice ? "Restrict" : "Expand"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="section-title" style={{ marginBottom: 4 }}>Add category option</div>
              </div>
              <div className="card-body">
                <form action={addCategoryAction} style={{ display: "flex", gap: 8 }}>
                  <select name="type" defaultValue="CLASS1" style={{ width: "auto" }}>
                    {Object.values(CategoryType).map((type) => (
                      <option key={type} value={type}>{CATEGORY_TYPE_LABELS[type] ?? type}</option>
                    ))}
                  </select>
                  <input name="value" placeholder="New value..." required style={{ flex: 1 }} />
                  <button type="submit">Add</button>
                </form>
              </div>
            </div>

            {Object.values(CategoryType).map((type) => (
              <div className="card" key={type}>
                <div className="card-body" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="section-title">{CATEGORY_TYPE_LABELS[type] ?? type}</div>
                    <Badge tone="neutral">{categoryGroups[type]?.length ?? 0}</Badge>
                  </div>
                </div>
                <div className="table-wrap">
                  <table style={{ border: "none", borderRadius: 0 }}>
                    <thead><tr><th>Value</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {(categoryGroups[type]?.length ?? 0) === 0 ? (
                        <tr><td colSpan={3} style={{ color: "var(--text-3)", fontSize: 13, padding: "16px 14px" }}>No options defined yet.</td></tr>
                      ) : categoryGroups[type].map((item) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 500 }}>{item.value}</td>
                          <td>{item.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Off</Badge>}</td>
                          <td>
                            <form action={toggleCategoryAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <input type="hidden" name="isActive" value={item.isActive ? "false" : "true"} />
                              <button type="submit" className="secondary btn-sm" style={{ fontSize: 11 }}>
                                {item.isActive ? "Disable" : "Enable"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, tone, sub }: { label: string; value: number; tone?: string; sub?: string }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warning)" : tone === "good" ? "var(--success)" : "var(--text)";
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ReassignForm({ users, action, companyOwners }: {
  users: { id: string; fullName: string }[];
  action: (fd: FormData) => Promise<void>;
  companyOwners: { userId: string; isPrimary: boolean; companyId: string }[];
}) {
  const counts = users.map((u) => ({
    ...u,
    count: companyOwners.filter((o) => o.userId === u.id && o.isPrimary).length,
  }));

  return (
    <form action={action} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>From</span>
        <select name="fromUserId" style={{ width: "auto" }}>
          <option value="">Select rep…</option>
          {counts.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName} ({u.count} accounts)</option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>To</span>
        <select name="toUserId" style={{ width: "auto" }}>
          <option value="">Select rep…</option>
          {counts.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName}</option>
          ))}
        </select>
      </div>
      <button type="submit">Reassign all accounts</button>
    </form>
  );
}
