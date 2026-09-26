import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { manifestFor, refreshFromEngine } from "@/src/lib/media";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await ctx.params;
  await refreshFromEngine(id);
  const manifest = manifestFor(user, id);
  if (!manifest) return NextResponse.json({ error: "Title not found." }, { status: 404 });
  return NextResponse.json(manifest);
}
