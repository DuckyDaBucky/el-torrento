import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { changePlayback } from "@/src/lib/media";
import type { ProfileId } from "@/src/lib/quality";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    positionSeconds?: number;
    quality?: ProfileId;
  };
  const rawPosition = Number(body.positionSeconds ?? 0);
  const position = Number.isFinite(rawPosition) ? Math.max(0, rawPosition) : 0;
  try {
    return NextResponse.json(await changePlayback(user, id, position, body.quality ?? "auto"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Playback refused." },
      { status: 403 },
    );
  }
}
