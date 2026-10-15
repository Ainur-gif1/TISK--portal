import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { hashToken, ipHash, publicUser, requireSameOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const bodySchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) });
const dummyHash = bcrypt.hash("not-a-real-college-password", 12);

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Сұраныстың көзі тексерілмеді." }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Логин мен құпиясөзді енгізіңіз." }, { status: 400 });
  const username = parsed.data.username.toLocaleLowerCase("en-US");
  const fingerprint = ipHash(request);
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const recentAttempts = await prisma.loginAttempt.count({ where: { username, ipHash: fingerprint, createdAt: { gte: since } } });
  if (recentAttempts >= 8) return NextResponse.json({ error: "Кіру әрекеті көп болды. 15 минуттан кейін қайталап көріңіз." }, { status: 429 });

  const user = await prisma.user.findUnique({ where: { username } });
  const hash = user?.passwordHash || await dummyHash;
  const matches = await bcrypt.compare(parsed.data.password, hash);
  if (!user || !user.active || !user.passwordHash || !matches) {
    await prisma.loginAttempt.create({ data: { username, ipHash: fingerprint } });
    return NextResponse.json({ error: "Логин немесе құпиясөз қате." }, { status: 401 });
  }

  await prisma.loginAttempt.deleteMany({ where: { username, ipHash: fingerprint } });
  const rawToken = randomBytes(32).toString("base64url");
  const ttlDays = Math.min(30, Math.max(1, Number(process.env.SESSION_TTL_DAYS || 7)));
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash: hashToken(rawToken), userId: user.id, expiresAt } });
  const response = NextResponse.json({ user: publicUser(user) });
  response.cookies.set(SESSION_COOKIE, rawToken, { ...sessionCookieOptions, maxAge: ttlDays * 24 * 60 * 60 });
  return response;
}
