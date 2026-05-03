import { NextResponse } from "next/server";
import { setupDemoEnvironment } from "@/lib/setup-demo-actions";

// Direct URL endpoint for running the demo setup. Bypasses the button — if
// the JS UI fails to fire the action, you can hit this URL in your browser
// while logged in and get a JSON response with the actual result.
//
// Both GET (browser-friendly) and POST work. Auth is enforced by
// setupDemoEnvironment's underlying requireSession call.
async function run() {
  try {
    const result = await setupDemoEnvironment();
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined,
    }, { status: 500 });
  }
}

export async function GET() { return run(); }
export async function POST() { return run(); }
