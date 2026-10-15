import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "tisk_session";
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = process.env.PORTAL_ORIGIN;
  return !!origin && !!allowed && origin === allowed;
}

export async function currentSession(request: NextRequest) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { include: { teacher: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
}

export function setSessionCookie(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
}

export function publicUser(user: {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  teacherId: string | null;
  studentNumber: string | null;
  groupId: string | null;
}) {
  return {
    id: user.id,
    login: user.username,
    name: user.displayName,
    role: user.role.toLowerCase(),
    teacherId: user.teacherId,
    studentNumber: user.studentNumber,
    groupId: user.groupId,
  };
}

export function ipHash(request: NextRequest) {
  // Trust only the single address overwritten by the configured reverse proxy.
  // Client supplied X-Forwarded-For values are easy to spoof and must not bypass throttling.
  const address = request.headers.get("x-real-ip")?.trim() || "unknown";
  return hashToken(address);
}
