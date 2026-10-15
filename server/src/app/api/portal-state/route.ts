import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, requireSameOrigin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const stateSchema = z.object({
  registry: z.unknown(),
  calendar: z.unknown(),
  schedule: z.unknown().optional(),
  adminName: z.string().max(120).optional(),
  year: z.unknown().optional(),
  operations: z.unknown().optional(),
}).passthrough();

export async function GET(request: NextRequest) {
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ error: "Жүйеге кіріңіз." }, { status: 401 });
  const record = await prisma.portalSetting.findUnique({ where: { key: "workspace-state" } });
  return NextResponse.json({ workspace: record?.value ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Сұраныстың көзі тексерілмеді." }, { status: 403 });
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ error: "Жүйеге кіріңіз." }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Бұл өзгерісті тек оқу бөлімі сақтай алады." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "Сақталатын дерек тым үлкен." }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return NextResponse.json({ error: "Дерек форматы қате." }, { status: 400 }); }
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "Портал күйінің деректері жарамсыз." }, { status: 400 });
  const old = await prisma.portalSetting.findUnique({ where: { key: "workspace-state" } });
  const workspace = parsed.data as Prisma.InputJsonValue;
  await prisma.$transaction([
    prisma.portalSetting.upsert({
      where: { key: "workspace-state" },
      create: { key: "workspace-state", value: workspace },
      update: { value: workspace },
    }),
    prisma.auditEvent.create({ data: {
      actorId: session.userId,
      action: "PORTAL_STATE_SAVED",
      entityType: "portal-state",
      entityId: "workspace-state",
      beforeData: old?.value as Prisma.InputJsonValue | undefined,
      afterData: workspace,
    } }),
  ]);
  return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
}
