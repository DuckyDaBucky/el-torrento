import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { readMediaRange } from "@/src/lib/media";
import type { ProfileId } from "@/src/lib/quality";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const result = await readMediaRange({
    user,
    id,
    generation: Number(url.searchParams.get("g") ?? "0"),
    profile: (url.searchParams.get("profile") ?? "original") as ProfileId,
    rangeHeader: req.headers.get("range"),
  });
  if ("message" in result) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return new NextResponse(new Uint8Array(result.body), {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(result.body.length),
      "Content-Range": `bytes ${result.start}-${result.end}/${result.totalAvailable}`,
      "Cache-Control": "no-store",
      "X-Available-Bytes": String(result.totalAvailable),
    },
  });
}
