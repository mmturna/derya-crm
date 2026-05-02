import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { exchangeCodeForTokens, getUserEmail } from "@/lib/gmail-oauth";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settingsUrl = new URL("/dashboard/settings/email", url.origin);

  if (error) {
    settingsUrl.searchParams.set("oauth_error", error);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code || !state) {
    settingsUrl.searchParams.set("oauth_error", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  // Verify state matches the nonce we set
  const c = await cookies();
  const nonce = c.get("gmail-oauth-nonce")?.value;
  const [stateOffice, stateNonce] = state.split(".");
  if (!nonce || stateNonce !== nonce || stateOffice !== session.officeId) {
    settingsUrl.searchParams.set("oauth_error", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }
  c.delete("gmail-oauth-nonce");

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await getUserEmail(tokens.access_token);

    // Upsert by (officeId, email)
    const existing = await prisma.emailAccount.findFirst({
      where: { officeId: session.officeId, email },
    });
    if (existing) {
      await prisma.emailAccount.update({
        where: { id: existing.id },
        data: {
          provider: "GMAIL",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? existing.refreshToken,
          isActive: true,
        },
      });
    } else {
      await prisma.emailAccount.create({
        data: {
          officeId: session.officeId,
          email,
          provider: "GMAIL",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          isActive: true,
        },
      });
    }

    settingsUrl.searchParams.set("oauth_success", email);
    return NextResponse.redirect(settingsUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "exchange_failed";
    settingsUrl.searchParams.set("oauth_error", msg);
    return NextResponse.redirect(settingsUrl);
  }
}
