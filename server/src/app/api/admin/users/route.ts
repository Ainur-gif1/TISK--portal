import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { currentSession, requireSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const createSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("TEACHER"), username: z.string().trim().min(3).max(100), displayName: z.string().trim().min(2).max(120), teacherId: z.string().min(1), password: z.string().min(12).max(200) }),
  z.object({ role: z.literal("STUDENT"), username: z.string().trim().min(3).max(100), displayName: z.string().trim().min(2).max(120), studentNumber: z.string().trim().min(1).max(40), groupId: z.string().min(1), password: z.string().min(12).max(200) }),
]);

export async function GET(request: NextRequest) {
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ error: "Жүйеге кіріңіз." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Рұқсат жоқ." }, { status: 403 });
  const users = await prisma.user.findMany({
    select: { id: true, username: true, displayName: true, role: true, active: true, teacherId: true, studentNumber: true, groupId: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Сұраныстың көзі тексерілмеді." }, { status: 403 });
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ error: "Жүйеге кіріңіз." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Аккаунтты тек оқу бөлімі аша алады." }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Аккаунт деректерін тексеріңіз; құпиясөз кемінде 12 таңбадан тұруы керек." }, { status: 400 });
  const value = parsed.data;
  if (value.role === "TEACHER" && !await prisma.teacher.findUnique({ where: { id: value.teacherId } })) return NextResponse.json({ error: "Оқытушы табылмады." }, { status: 404 });
  if (value.role === "STUDENT" && !await prisma.collegeGroup.findUnique({ where: { id: value.groupId } })) return NextResponse.json({ error: "Топ табылмады." }, { status: 404 });
  const username = value.username.toLocaleLowerCase("en-US");
  const passwordHash = await bcrypt.hash(value.password, 12);
  try {
    const user = await prisma.$transaction(async tx => {
      const saved = await tx.user.upsert({
        where: { username },
        create: {
          username, displayName: value.displayName, role: value.role, passwordHash, active: true,
          teacherId: value.role === "TEACHER" ? value.teacherId : null,
          studentNumber: value.role === "STUDENT" ? value.studentNumber : null,
          groupId: value.role === "STUDENT" ? value.groupId : null,
        },
        update: {
          displayName: value.displayName, role: value.role, passwordHash, active: true,
          teacherId: value.role === "TEACHER" ? value.teacherId : null,
          studentNumber: value.role === "STUDENT" ? value.studentNumber : null,
          groupId: value.role === "STUDENT" ? value.groupId : null,
        },
      });
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "USER_ACCOUNT_SET", entityType: "user", entityId: saved.id, afterData: { username, role: value.role, displayName: value.displayName } } });
      return saved;
    });
    return NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, active: user.active } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Бұл логин, оқытушы нөмірі немесе студент нөмірі басқа аккаунтта қолданылған." }, { status: 409 });
  }
}
