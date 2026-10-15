import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, currentSession, hashToken, requireSameOrigin, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Сұраныстың көзі тексерілмеді." }, { status: 403 });
  const session = await currentSession(request);
  if (session) await prisma.session.delete({ where: { id: session.id } });
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
