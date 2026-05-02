"use client";
import { useState } from "react";
import Link from "next/link";
import { completeTaskAction, resolveQuoteAction } from "@/app/dashboard/activity/actions";

type TaskCard = {
  id: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
  company: { id: string; name: string };
};

type QuoteCard = {
  id: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  value: number | null;
  currency: string | null;
  daysOld: number;
  company: { id: string; name: string };
};

type StaleCard = {
  id: string;
  name: string;
  daysSince: number | null;
};

function SectionLabel({ children, count, tone }: { children: React.ReactNode; count?: number; tone?: "danger" | "warning" | "default" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : "var(--text-3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color }}>
        {children}
      </span>
      {count !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
          background: tone === "danger" ? "var(--danger-bg)" : tone === "warning" ? "var(--warning-bg)" : "var(--surface-3)",
          color: tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : "var(--text-3)",
          border: `1px solid ${tone === "danger" ? "var(--danger-border)" : tone === "warning" ? "var(--warning-border)" : "var(--border)"}`,
        }}>
          {count}
        </span>
      )}
    </div>
  );
}

export function ActivityFeed({
  tasks,
  quotes,
  stale,
  userName,
}: {
  tasks: TaskCard[];
  quotes: QuoteCard[];
  stale: StaleCard[];
  userName: string;
}) {
  const [taskList, setTaskList] = useState(tasks);
  const [quoteList, setQuoteList] = useState(quotes);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showAllQuotes, setShowAllQuotes] = useState(false);
  const OVERDUE_PREVIEW = 5;
  const QUOTES_PREVIEW = 5;

  async function doneTask(id: string) {
    setDoneIds((prev) => new Set([...prev, id]));
    setBusy(id);
    await completeTaskAction(id);
    setTaskList((prev) => prev.filter((t) => t.id !== id));
    setDoneIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    setBusy(null);
  }

  async function resolveQuote(id: string, result: "WON" | "LOST") {
    setBusy(id);
    setQuoteList((prev) => prev.filter((q) => q.id !== id));
    await resolveQuoteAction(id, result);
    setBusy(null);
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const overdueTasks = taskList.filter((t) => t.isOverdue);
  const dueTodayTasks = taskList.filter((t) => !t.isOverdue);
  const allEmpty = taskList.length === 0 && quoteList.length === 0 && stale.length === 0;
  const visibleOverdue = showAllOverdue ? overdueTasks : overdueTasks.slice(0, OVERDUE_PREVIEW);
  const visibleQuotes = showAllQuotes ? quoteList : quoteList.slice(0, QUOTES_PREVIEW);

  return (
    <div style={{ maxWidth: 680 }}>

      {/* Greeting */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
          {greeting}, {userName.split(" ")[0]}.
        </h2>
        {!allEmpty && (
          <p style={{ marginTop: 3, fontSize: 13, color: "var(--text-3)" }}>
            Here&apos;s what needs your attention.
          </p>
        )}
      </div>

      {allEmpty && (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "40px 24px",
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 14,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
          No open tasks, no pending quotes, no stale accounts.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

        {/* Overdue tasks */}
        {overdueTasks.length > 0 && (
          <section>
            <SectionLabel count={overdueTasks.length} tone="danger">Overdue</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {visibleOverdue.map((task) => (
                <TaskRow key={task.id} task={task} onDone={doneTask} isDone={doneIds.has(task.id)} busy={busy === task.id} />
              ))}
            </div>
            {overdueTasks.length > OVERDUE_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllOverdue((v) => !v)}
                style={{ marginTop: 6, fontSize: 12, color: "var(--danger)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontWeight: 600 }}
              >
                {showAllOverdue ? "Show less" : `+ ${overdueTasks.length - OVERDUE_PREVIEW} more overdue`}
              </button>
            )}
          </section>
        )}

        {/* Due today tasks */}
        {dueTodayTasks.length > 0 && (
          <section>
            <SectionLabel count={dueTodayTasks.length} tone="warning">Due today</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {dueTodayTasks.map((task) => (
                <TaskRow key={task.id} task={task} onDone={doneTask} isDone={doneIds.has(task.id)} busy={busy === task.id} />
              ))}
            </div>
          </section>
        )}

        {/* Pending quotes */}
        {quoteList.length > 0 && (
          <section>
            <SectionLabel count={quoteList.length} tone="warning">Awaiting response</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {visibleQuotes.map((q) => (
                <QuoteRow key={q.id} quote={q} onResolve={resolveQuote} busy={busy === q.id} />
              ))}
            </div>
            {quoteList.length > QUOTES_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllQuotes((v) => !v)}
                style={{ marginTop: 6, fontSize: 12, color: "var(--warning)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontWeight: 600 }}
              >
                {showAllQuotes ? "Show less" : `+ ${quoteList.length - QUOTES_PREVIEW} more quotes`}
              </button>
            )}
          </section>
        )}

        {/* Stale */}
        {stale.length > 0 && (
          <section>
            <SectionLabel count={stale.length}>No recent contact</SectionLabel>
            <div style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}>
              {stale.map((c, i) => (
                <div key={c.id} style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "11px 16px",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                }}>
                  <Link href={`/dashboard/customers/${c.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {c.name}
                  </Link>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {c.daysSince !== null ? `${c.daysSince} days ago` : "Never"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, onDone, isDone, busy }: {
  task: TaskCard;
  onDone: (id: string) => void;
  isDone: boolean;
  busy: boolean;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 14px",
      background: "var(--surface)",
      borderRadius: 8,
      opacity: isDone ? 0.4 : 1,
      transition: "opacity 0.2s",
      marginBottom: 2,
    }}>
      <button
        type="button"
        onClick={() => onDone(task.id)}
        disabled={busy || isDone}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `2px solid ${task.isOverdue ? "var(--danger)" : "var(--border-strong)"}`,
          background: "transparent",
          cursor: "pointer",
          flexShrink: 0,
          padding: 0,
          transition: "all 0.15s",
          position: "relative",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget.style.background) = task.isOverdue ? "var(--danger-bg)" : "var(--surface-3)";
          (e.currentTarget.style.borderColor) = task.isOverdue ? "var(--danger)" : "var(--brand)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget.style.background) = "transparent";
          (e.currentTarget.style.borderColor) = task.isOverdue ? "var(--danger)" : "var(--border-strong)";
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{task.title}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 8 }}>·</span>
        <Link href={`/dashboard/customers/${task.company.id}`} style={{ fontSize: 12, color: "var(--brand)", marginLeft: 8 }}>
          {task.company.name}
        </Link>
      </div>
      {task.dueAt && (
        <span style={{ fontSize: 11, fontWeight: 600, color: task.isOverdue ? "var(--danger)" : "var(--warning)", flexShrink: 0 }}>
          {new Date(task.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </span>
      )}
    </div>
  );
}

function QuoteRow({ quote, onResolve, busy }: {
  quote: QuoteCard;
  onResolve: (id: string, result: "WON" | "LOST") => void;
  busy: boolean;
}) {
  const urgent = quote.daysOld >= 5;
  const aging = quote.daysOld >= 2;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 14px",
      background: "var(--surface)",
      borderRadius: 8,
      marginBottom: 2,
      borderLeft: `3px solid ${urgent ? "var(--danger)" : aging ? "var(--warning)" : "var(--border)"}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link href={`/dashboard/customers/${quote.company.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {quote.company.name}
        </Link>
        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {quote.origin && quote.destination
            ? <span>{quote.origin} → {quote.destination}</span>
            : <span>Quote pending</span>}
          {quote.mode && <span style={{ background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px", fontSize: 10 }}>{quote.mode}</span>}
          {quote.value && <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{quote.value.toLocaleString()} {quote.currency ?? ""}</span>}
        </div>
      </div>
      <span style={{ fontSize: 11, color: urgent ? "var(--danger)" : aging ? "var(--warning)" : "var(--text-3)", fontWeight: aging ? 600 : 400, flexShrink: 0 }}>
        {quote.daysOld === 0 ? "Today" : `${quote.daysOld}d`}
      </span>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(quote.id, "WON")}
          style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: "var(--success-bg)", color: "var(--success)",
            border: "1px solid var(--success-border)", cursor: "pointer",
          }}
        >Won</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(quote.id, "LOST")}
          style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: "var(--danger-bg)", color: "var(--danger)",
            border: "1px solid var(--danger-border)", cursor: "pointer",
          }}
        >Lost</button>
      </div>
    </div>
  );
}
