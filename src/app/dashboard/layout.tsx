import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { getLang } from "@/lib/i18n";
import { getFocusedJob, clearFocusAction } from "@/lib/job-focus";
import { AgentChatWidget } from "@/components/agent-chat-widget";
import { CommandPalette } from "@/components/command-palette";
import { LiveEventToast } from "@/components/live-event-toast";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.email.slice(0, 2).toUpperCase();
  const lang = await getLang();

  // Live pipeline status for the topbar
  const [activeJobs, pendingRFQs, overdueJobs, focusedJob] = await Promise.all([
    prisma.job.count({
      where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    }),
    prisma.inquiry.count({
      where: { officeId: session.officeId, status: { in: ["INGESTED", "PARSED", "PRICED"] } },
    }),
    prisma.job.count({
      where: {
        officeId: session.officeId,
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        eta: { lt: new Date() },
      },
    }),
    getFocusedJob(session.officeId),
  ]);

  const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
    INQUIRY:    { label: "Inquiry",    bg: "#eef2ff", fg: "#1e3a8a" },
    QUOTED:     { label: "Quoted",     bg: "#fffbeb", fg: "#b45309" },
    BOOKED:     { label: "Booked",     bg: "#eff6ff", fg: "#1d4ed8" },
    IN_TRANSIT: { label: "In Transit", bg: "#f5f3ff", fg: "#6d28d9" },
    CUSTOMS:    { label: "Customs",    bg: "#fff7ed", fg: "#c2410c" },
    DELIVERED:  { label: "Delivered",  bg: "#ecfdf5", fg: "#047857" },
    CANCELLED:  { label: "Cancelled",  bg: "#f3f4f6", fg: "#6b7280" },
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand">
            <div className="brand-icon">D</div>
            <div>
              <div>Derya</div>
              <div className="brand-sub">Freight OS</div>
            </div>
          </div>
          <SidebarToggle />
        </div>

        <nav className="sidebar-nav">
          {/* ─── WORKBENCH (the main page) ───────────────────────────────── */}
          <NavLink href="/dashboard" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="9" y1="21" x2="9" y2="9"/>
            </svg>
          }>Workbench</NavLink>

          {/* ─── RECORDS (browseable lists, history, references) ────────── */}
          <div className="nav-section-label with-rule">Records</div>

          <NavLink href="/dashboard/jobs" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" rx="1"/>
              <path d="M16 8h4l3 5v3h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          }>Jobs</NavLink>

          <NavLink href="/dashboard/rfq" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
          }>Sources</NavLink>

          <NavLink href="/dashboard/customers" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }>Customers</NavLink>

          <NavLink href="/dashboard/pricing" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          }>Lane Rates</NavLink>

          <NavLink href="/dashboard/reports" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
              <line x1="2" y1="20" x2="22" y2="20"/>
            </svg>
          }>Reports</NavLink>

          <NavLink href="/dashboard/activity" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          }>Activity</NavLink>

          {/* ─── SETUP ───────────────────────────────────────────────────── */}
          <div className="nav-section-label with-rule">Setup</div>

          <NavLink href="/dashboard/settings/email" icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          }>Email</NavLink>

          {(session.role === "ADMIN" || session.role === "MANAGER") && (
            <NavLink href="/dashboard/admin" icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            }>Admin</NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-block">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{session.email.split("@")[0]}</div>
              <div className="user-role" style={{ textTransform: "capitalize" }}>{session.role.toLowerCase()}</div>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbar-left">
            <a href="/dashboard" className="topbar-brand">
              <span className="brand-icon-mini">D</span>
              <span>Derya</span>
            </a>
          </div>
          <div className="topbar-center">
            <CommandPalette />
          </div>
          <div className="topbar-right">
            <a href="/dashboard/jobs" className="topbar-stat" title="Active jobs">
              <strong>{activeJobs}</strong> active
            </a>
            {pendingRFQs > 0 && (
              <a href="/dashboard/rfq" className="topbar-stat brand" title="RFQs awaiting action">
                <strong>{pendingRFQs}</strong> awaiting
              </a>
            )}
            {overdueJobs > 0 && (
              <a href="/dashboard/jobs" className="topbar-stat danger" title="Jobs past ETA">
                <strong>{overdueJobs}</strong> past ETA
              </a>
            )}
            <span className="topbar-divider" />
            <details className="topbar-menu">
              <summary aria-label="User menu">
                <span className="topbar-avatar">{initials}</span>
              </summary>
              <div className="topbar-menu-panel">
                <div className="topbar-menu-header">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{session.email.split("@")[0]}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{session.email}</div>
                </div>
                <a href="/dashboard/settings/email" className="topbar-menu-item">Email accounts</a>
                {(session.role === "ADMIN" || session.role === "MANAGER") && (
                  <a href="/dashboard/admin" className="topbar-menu-item">Admin</a>
                )}
                <div className="topbar-menu-divider" />
                <div className="topbar-menu-row">
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>Language</span>
                  <LangToggle current={lang} />
                </div>
                <div className="topbar-menu-divider" />
                <div className="topbar-menu-item topbar-menu-logout">
                  <LogoutButton />
                </div>
              </div>
            </details>
          </div>
        </header>

        {/* Focused-job context strip — travels across pages */}
        {focusedJob && (() => {
          const meta = STATUS_META[focusedJob.status] ?? STATUS_META.INQUIRY;
          const route = focusedJob.origin && focusedJob.destination
            ? `${focusedJob.origin} → ${focusedJob.destination}`
            : focusedJob.origin ?? focusedJob.destination ?? "Route TBD";
          return (
            <div className="job-focus-strip">
              <div className="job-focus-strip-inner">
                <span className="job-focus-icon" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/>
                    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                  </svg>
                </span>
                <span className="job-focus-label">FOCUSED</span>
                <a href={`/dashboard/jobs/${focusedJob.id}`} className="job-focus-ref">
                  {focusedJob.reference}
                </a>
                <span className="job-focus-sep">·</span>
                <span className="job-focus-customer">{focusedJob.customerName ?? "No customer"}</span>
                <span className="job-focus-sep">·</span>
                <span className="job-focus-route">{route}</span>
                {focusedJob.mode && (
                  <>
                    <span className="job-focus-sep">·</span>
                    <span className="job-focus-mode">{focusedJob.mode}</span>
                  </>
                )}
                <span className="job-focus-status" style={{ background: meta.bg, color: meta.fg }}>
                  {meta.label}
                </span>

                <div className="job-focus-actions">
                  <a href={`/dashboard/jobs/${focusedJob.id}`} className="job-focus-link">
                    Open
                  </a>
                  {focusedJob.customerId && (
                    <a href={`/dashboard/customers/${focusedJob.customerId}`} className="job-focus-link">
                      Customer
                    </a>
                  )}
                  {focusedJob.inquiryId && (
                    <a href={`/dashboard/rfq/${focusedJob.inquiryId}`} className="job-focus-link">
                      Source RFQ
                    </a>
                  )}
                  <a href={`/api/jobs/${focusedJob.id}/quote-pdf`} target="_blank" className="job-focus-link">
                    Quote PDF
                  </a>
                  <form action={clearFocusAction}>
                    <button type="submit" className="job-focus-clear" aria-label="Clear focus" title="Clear focus">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </form>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="page-container">
          {children}
        </div>
      </section>

      <AgentChatWidget />
      <LiveEventToast />
    </div>
  );
}
