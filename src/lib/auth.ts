import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const SESSION_COOKIE = "crm_session";
const ONE_DAY = 60 * 60 * 24;

type SessionPayload = {
  userId: string;
  officeId: string;
  email: string;
  role: string;
  canViewWholeOffice: boolean;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is missing.");
  }
  return secret;
}

function sign(input: string) {
  return crypto.createHmac("sha256", getSecret()).update(input).digest("hex");
}

function encodeSession(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const base = Buffer.from(json).toString("base64url");
  const sig = sign(base);
  return `${base}.${sig}`;
}

function decodeSession(token: string): SessionPayload | null {
  const [base, sig] = token.split(".");
  if (!base || !sig) return null;
  if (sign(base) !== sig) return null;
  try {
    const decoded = Buffer.from(base, "base64url").toString("utf-8");
    return JSON.parse(decoded) as SessionPayload;
  } catch {
    return null;
  }
}

export async function loginWithCredentials(email: string, password: string) {
  const users = await prisma.user.findMany({
    where: { email, isActive: true },
    select: { id: true, email: true, officeId: true, role: true, passwordHash: true, canViewWholeOffice: true }
  });

  if (users.length === 0) return null;

  let user:
    | {
        id: string;
        email: string;
        officeId: string;
        role: string;
        passwordHash: string;
        canViewWholeOffice: boolean;
      }
    | null = null;

  for (const candidate of users) {
    if (await verifyPassword(password, candidate.passwordHash)) {
      user = candidate;
      break;
    }
  }

  if (!user) return null;

  const token = encodeSession({
    userId: user.id,
    officeId: user.officeId,
    email: user.email,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_DAY * 7
  });

  return { userId: user.id, officeId: user.officeId, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decodeSession(token);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

