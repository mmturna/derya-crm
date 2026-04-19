import { requireSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { NotificationBellServer } from "@/components/notification-bell-server";
import { TopbarSearch } from "@/components/topbar-search";
import { getLang, getT } from "@/lib/i18n";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.email.slice(0, 2).toUpperCase();
  const lang = await getLang();
  const t = getT(lang);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand">
            <div className="brand-icon">D</div>
            <div>
              <div>Derya CRM</div>
              <div className="brand-sub">Freight Sales</div>
            </div>
          </div>
          <SidebarToggle />
        </div>

        <nav className="sidebar-nav">
          <NavLink href="/dashboard/customers" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a7 7 0 0 1 7-7h0a7 7 0 0 1 7 7v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>}>{t.nav.customers}</NavLink>
          <NavLink href="/dashboard/pipeline" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/></svg>}>{t.nav.pipeline}</NavLink>
          <NavLink href="/dashboard/activity" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}>{t.nav.activity}</NavLink>
          <NavLink href="/dashboard/reports" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>}>{t.nav.reports}</NavLink>
          {(session.role === "ADMIN" || session.role === "MANAGER") && (
            <>
              <span className="nav-section-label">{t.nav.administration}</span>
              <NavLink href="/dashboard/admin" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}>Team</NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-block">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{session.email.split("@")[0]}</div>
              <div className="user-role">{session.role}</div>
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
            <span className="topbar-title">{t.topbar.title}</span>
          </div>
          <div className="topbar-center">
            <TopbarSearch placeholder={t.topbar.searchPlaceholder} />
          </div>
          <div className="topbar-right">
            <NotificationBellServer />
            <LangToggle current={lang} />
          </div>
        </header>
        <div className="page-container">
          {children}
        </div>
      </section>
    </div>
  );
}
