import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getLang, getT } from "@/lib/i18n";
import { refreshRiskAlerts, shouldRunRiskScan } from "@/lib/risk";
import { ActivityFeed } from "@/components/activity-feed";

export default async function ActivityPage() {
  const session = await requireSession();
  const currentUser = await prisma.user.findUnique({ where: { id: session.userId }, select: { fullName: true } });
  const lang = await getLang();
  const t = getT(lang);
  const canViewAll =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.canViewWholeOffice;
  const companyScope = canViewAll
    ? { officeId: session.officeId }
    : { officeId: session.officeId, owners: { some: { userId: session.userId } } };

  // Auto-run risk scan if it hasn't run in the last 4 hours
  if (await shouldRunRiskScan(session.officeId)) {
    await refreshRiskAlerts(session.officeId);
  }

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const staleDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const taskScope = canViewAll
    ? { officeId: session.officeId, status: "OPEN" as const }
    : { officeId: session.officeId, status: "OPEN" as const, company: { owners: { some: { userId: session.userId } } } };

  const [urgentTasks, allOpenTasks, pendingQuotes, staleRaw] = await Promise.all([
    // Overdue + due today
    prisma.task.findMany({
      where: { ...taskScope, dueAt: { lte: todayEnd } },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 30,
    }),
    // All open tasks
    prisma.task.findMany({
      where: taskScope,
      include: { company: { select: { id: true, name: true } } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    // Pending quotes
    prisma.quote.findMany({
      where: {
        officeId: session.officeId,
        result: "PENDING",
        ...(canViewAll ? {} : { company: { owners: { some: { userId: session.userId } } } }),
      },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { quotedAt: "asc" },
      take: 30,
    }),
    // Stale companies
    prisma.company.findMany({
      where: companyScope,
      include: { activities: { orderBy: { occurredAt: "desc" }, take: 1 } },
      take: 60,
    }),
  ]);

  const staleCompanies = staleRaw
    .filter((c) => c.activities.length === 0 || new Date(c.activities[0].occurredAt) < staleDate)
    .slice(0, 20);

  function daysSince(date: Date | string): number {
    return Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  }

  const overdueCount = urgentTasks.filter((task) => task.dueAt && new Date(task.dueAt) < now).length;
  const totalItems = urgentTasks.length + pendingQuotes.length;

  return (
    <ActivityFeed
      userName={currentUser?.fullName ?? session.email}
      tasks={urgentTasks.map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        isOverdue: !!(task.dueAt && new Date(task.dueAt) < now),
        company: task.company,
      }))}
      quotes={pendingQuotes.map((q) => ({
        id: q.id,
        origin: q.origin ?? null,
        destination: q.destination ?? null,
        mode: q.mode ?? null,
        value: q.value ?? null,
        currency: q.currency ?? null,
        daysOld: daysSince(q.quotedAt),
        company: q.company,
      }))}
      stale={staleCompanies.map((c) => ({
        id: c.id,
        name: c.name,
        daysSince: c.activities[0]?.occurredAt ? daysSince(c.activities[0].occurredAt) : null,
      }))}
    />
  );
}
