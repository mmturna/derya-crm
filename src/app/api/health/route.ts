import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public health check — no auth required. Reports build SHA, env vars
// (just presence, not values), DB connection, and whether each recently-
// added Prisma column is readable. Safe to share output for debugging.
export async function GET() {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const env = {
    NODE_ENV: process.env.NODE_ENV ?? "unknown",
    VERCEL_ENV: process.env.VERCEL_ENV ?? "unknown",
    VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    AUTH_SECRET: !!process.env.AUTH_SECRET,
    DATABASE_URL: !!process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ?? "unset",
    CRON_SECRET: !!process.env.CRON_SECRET,
  };

  try { await prisma.$queryRaw`SELECT 1`; checks.push({ name: "db_ping", ok: true }); }
  catch (e) { checks.push({ name: "db_ping", ok: false, detail: msg(e) }); }

  try { await prisma.emailThread.findFirst({ select: { id: true, snoozedUntil: true, hiddenAt: true, awardedAt: true, supplierOffer: true, externalThreadId: true } }); checks.push({ name: "emailThread_recent_fields", ok: true }); }
  catch (e) { checks.push({ name: "emailThread_recent_fields", ok: false, detail: msg(e) }); }

  try { await prisma.job.findFirst({ select: { id: true, parentJobId: true, portalToken: true, notifyCustomer: true, customerEmail: true } }); checks.push({ name: "job_recent_fields", ok: true }); }
  catch (e) { checks.push({ name: "job_recent_fields", ok: false, detail: msg(e) }); }

  try { await prisma.jobDocument.findFirst({ select: { id: true, aiSummary: true, aiFlags: true, aiKeyFields: true, aiAnalyzedAt: true } }); checks.push({ name: "jobDocument_recent_fields", ok: true }); }
  catch (e) { checks.push({ name: "jobDocument_recent_fields", ok: false, detail: msg(e) }); }

  try { await prisma.emailMessage.findFirst({ select: { id: true, gmailMessageId: true } }); checks.push({ name: "emailMessage_gmailMessageId", ok: true }); }
  catch (e) { checks.push({ name: "emailMessage_gmailMessageId", ok: false, detail: msg(e) }); }

  const allOk = checks.every((c) => c.ok);
  return NextResponse.json({
    ok: allOk,
    timestamp: new Date().toISOString(),
    env,
    checks,
  }, { status: allOk ? 200 : 500 });
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
}
