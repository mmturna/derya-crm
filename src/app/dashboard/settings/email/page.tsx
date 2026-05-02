import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function disconnectAccount(accountId: string) {
  "use server";
  const session = await requireSession();
  await prisma.emailAccount.update({
    where: { id: accountId, officeId: session.officeId },
    data: { isActive: false },
  });
  revalidatePath("/dashboard/settings/email");
}

function timeAgo(d: Date | null | undefined) {
  if (!d) return "Never";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const PROVIDER_ICONS: Record<string, string> = {
  GMAIL: "G", OUTLOOK: "O", IMAP: "M",
};

export default async function EmailSettingsPage() {
  const session = await requireSession();

  const accounts = await prisma.emailAccount.findMany({
    where: { officeId: session.officeId },
    orderBy: { createdAt: "desc" },
  });

  const active = accounts.filter((a) => a.isActive);
  const inactive = accounts.filter((a) => !a.isActive);

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard/rfq" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          RFQ Inbox
        </a>
      </div>

      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Email Accounts</h1>
          <p className="page-subtitle">Connect inboxes to auto-capture inbound RFQs</p>
        </div>
      </div>

      {/* How it works */}
      <div className="card" style={{ marginBottom: 20, background: "var(--brand-light)", border: "1px solid var(--brand-border)" }}>
        <div className="card-body">
          <div style={{ fontWeight: 700, color: "var(--brand)", marginBottom: 8, fontSize: 13 }}>How it works</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { step: "1", title: "Connect inbox", desc: "Authorize Gmail or Outlook. We only read, never send without you." },
              { step: "2", title: "Auto-capture RFQs", desc: "Incoming freight requests are parsed and appear in your RFQ inbox." },
              { step: "3", title: "Convert to Jobs", desc: "Review parsed fields, add rates, and convert winning RFQs to jobs." },
            ].map(({ step, title, desc }) => (
              <div key={step} style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{step}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connect buttons */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 14 }}>Connect an Inbox</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, justifyContent: "center", gap: 10, padding: "12px 16px" }}
              title="OAuth not yet configured — add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to .env"
            >
              <span style={{ width: 20, height: 20, borderRadius: 4, background: "#EA4335", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>G</span>
              Connect Gmail
            </button>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, justifyContent: "center", gap: 10, padding: "12px 16px" }}
              title="OAuth not yet configured — add AZURE_CLIENT_ID / AZURE_CLIENT_SECRET to .env"
            >
              <span style={{ width: 20, height: 20, borderRadius: 4, background: "#0078D4", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>O</span>
              Connect Outlook
            </button>
          </div>

          {/* IMAP manual */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)", cursor: "pointer", padding: "8px 0", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              Or connect via IMAP
            </summary>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div className="form-grid-2" style={{ marginBottom: 10 }}>
                <label className="field"><span>IMAP Host</span><input placeholder="mail.yourdomain.com" /></label>
                <label className="field"><span>Port</span><input type="number" defaultValue={993} /></label>
                <label className="field"><span>Email Address</span><input type="email" placeholder="rfq@yourco.com" /></label>
                <label className="field"><span>Password / App Password</span><input type="password" placeholder="••••••••" /></label>
              </div>
              <button className="btn btn-secondary" type="button">Test & Connect</button>
            </div>
          </details>
        </div>
      </div>

      {/* Connected accounts */}
      {active.length > 0 && (
        <div className="card-flush" style={{ marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <div className="section-title">Connected ({active.length})</div>
          </div>
          {active.map((account) => (
            <div key={account.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--brand-light)", border: "1px solid var(--brand-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "var(--brand)" }}>
                  {PROVIDER_ICONS[account.provider] ?? "M"}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{account.email}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {account.provider} · Last sync {timeAgo(account.lastSyncAt)}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="badge badge-good">Active</span>
                <form action={disconnectAccount.bind(null, account.id)}>
                  <button className="btn btn-secondary btn-sm" type="submit">Disconnect</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {active.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No connected inboxes</div>
          <p style={{ fontSize: 13, color: "var(--text-3)" }}>
            Connect Gmail or Outlook above to start capturing RFQs automatically.
          </p>
        </div>
      )}

      {/* Setup instructions */}
      <div className="card">
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 12 }}>To enable OAuth, add to your .env</div>
          <pre style={{ fontSize: 12, background: "var(--surface-2)", padding: 14, borderRadius: "var(--radius)", border: "1px solid var(--border)", overflowX: "auto", margin: 0, color: "var(--text-2)", lineHeight: 1.8 }}>
{`# Gmail
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback

# Outlook
AZURE_CLIENT_ID=your_client_id
AZURE_CLIENT_SECRET=your_client_secret
AZURE_REDIRECT_URI=http://localhost:3000/api/auth/outlook/callback`}
          </pre>
        </div>
      </div>
    </div>
  );
}
