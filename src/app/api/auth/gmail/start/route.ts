import { NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/gmail-oauth";

export async function GET() {
  try {
    const { url } = await getGmailAuthUrl();
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start OAuth";
    return new NextResponse(`OAuth start failed: ${msg}`, { status: 500 });
  }
}
