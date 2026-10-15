import { NextRequest, NextResponse } from "next/server";
import { currentSession, publicUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ user: null }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ user: publicUser(session.user) }, { headers: { "Cache-Control": "no-store" } });
}
