import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb, readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { ensureHls, hlsDir } from "@/src/lib/hls";
import { getMedia } from "@/src/lib/media";
import type { ProfileId } from "@/src/lib/quality";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; generation: string; profile: string; file: string }> },
) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.status !== "active") {
    return NextResponse.json({ error: "Playback is not allowed for this account." }, { status: 403 });
  }
  const { id, generation: generationRaw, profile, file } = await ctx.params;
  if (file.includes("..") || (file !== "index.m3u8" && !/^seg_\d+\.ts$/.test(file))) {
    return NextResponse.json({ error: "That HLS path is not allowed." }, { status: 404 });
  }
  const generation = Number(generationRaw);
  const row = getMedia(id);
  if (!row) return NextResponse.json({ error: "Title not found." }, { status: 404 });
  const playback = getDb()
    .prepare("SELECT generation, position_sec FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, id) as { generation: number; position_sec: number } | undefined;
  if (!playback || playback.generation !== generation) {
    return NextResponse.json({ error: "This playback request is stale." }, { status: 409 });
  }
  if (file === "index.m3u8") {
    try {
      const built = await ensureHls({
        row,
        generation,
        profile: profile as ProfileId,
        positionSec: playback.position_sec ?? 0,
      });
      if (!built.ready || !built.playlist) {
        return NextResponse.json(
          { error: "Not enough verified pieces to start this rendition yet." },
          { status: 503, headers: { "Retry-After": "1" } },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "The HLS worker could not start from the verified pieces." },
        { status: 503, headers: { "Retry-After": "1" } },
      );
    }
  }
  const body = await readFile(path.join(hlsDir(id, generation, profile), file)).catch(() => null);
  if (!body) return NextResponse.json({ error: "Segment not ready." }, { status: 404 });
  const type = file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";
  return new NextResponse(body, {
    headers: { "Content-Type": type, "Cache-Control": "no-store" },
  });
}
