import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { seekPlayback } from "@/src/lib/media";
import type { ProfileId } from "@/src/lib/quality";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { profile?: ProfileId; seconds?: number };
  try {
    return NextResponse.json(seekPlayback(user, id, Number(body.seconds ?? 0), body.profile ?? "original"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Seek refused." },
      { status: 403 },
    );
  }
}
