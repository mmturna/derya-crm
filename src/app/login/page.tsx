import { redirect } from "next/navigation";
import { getSession, loginWithCredentials } from "@/lib/auth";

type Params = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Params) {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const hasError = query.error === "1";

  async function loginAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    const result = await loginWithCredentials(email, password);
    if (!result) {
      redirect("/login?error=1");
    }

    redirect("/dashboard");
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">D</div>
          <h1 className="login-title">Derya CRM</h1>
          <p className="login-subtitle">Freight Sales Workspace — sign in to continue</p>
        </div>

        <div className="login-body">
          {hasError && (
            <div className="error-text">
              Invalid email or password. Please try again.
            </div>
          )}

          <form action={loginAction} className="field" style={{ gap: 14 }}>
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                required
                defaultValue="admin@demo.local"
                placeholder="you@company.com"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                required
                defaultValue="admin1234"
                placeholder="••••••••"
              />
            </label>
            <button type="submit" style={{ marginTop: 4, padding: "10px 14px", fontSize: 14 }}>
              Sign in
            </button>
          </form>

          <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
            Demo: admin@demo.local / admin1234
          </p>
        </div>
      </div>
    </main>
  );
}
