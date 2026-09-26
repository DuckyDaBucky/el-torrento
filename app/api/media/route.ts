import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { createRequest, listMedia, listRequests, saveSeerrRequest } from "@/src/lib/media";
import { requestTitleInSeerr } from "@/src/lib/services";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ media: listMedia(), requests: listRequests().filter((item) => item.email === user.email || user.role === "owner") });
}

export async function POST(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  try {
    const created = createRequest(user, body.title ?? "");
    const seerr = await requestTitleInSeerr({
      title: body.title ?? "",
      baseUrl: process.env.SEERR_URL,
      apiKey: process.env.SEERR_API_KEY,
    });
    if (seerr.externalId) saveSeerrRequest(created.id, seerr.externalId, null);
    return NextResponse.json({ ...created, seerr });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not request that title." },
      { status: 400 },
    );
  }
}
