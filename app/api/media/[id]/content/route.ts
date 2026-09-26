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
    const headers = result.status === 503 ? { "Retry-After": "1" } : undefined;
    return NextResponse.json({ error: result.message }, { status: result.status, headers });
  }
  if (result.body.length === 0) {
    return NextResponse.json(
      { error: "Verified bytes were not ready to read." },
      { status: 503, headers: { "Retry-After": "1" } },
    );
  }
  return new NextResponse(new Uint8Array(result.body), {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(result.body.length),
      "Content-Range": `bytes ${result.start}-${result.end}/${result.fileSize}`,
      "Cache-Control": "no-store",
      "X-File-Size": String(result.fileSize),
    },
  });
}
