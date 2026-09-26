import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { openPlayback } from "@/src/lib/media";
import type { ProfileId } from "@/src/lib/quality";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { profile?: ProfileId };
  try {
    return NextResponse.json(openPlayback(user, id, body.profile ?? "original"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Playback refused." },
      { status: 403 },
    );
  }
}
