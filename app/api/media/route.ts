import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { listMedia, listRequests } from "@/src/lib/media";
import { decideWatchNow, FAMILY_COPY, type TitleIdentity } from "@/src/lib/resolver";
import { placeTitleRequest } from "@/src/lib/services";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({
    media: listMedia(),
    requests: listRequests().filter((item) => item.email === user.email || user.role === "owner"),
    familyCopy: FAMILY_COPY,
  });
}

export async function POST(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    intent?: string;
    title?: string;
    tmdbId?: string;
    mediaType?: "movie" | "tv";
    year?: string | number | null;
    season?: number | null;
    episode?: number | null;
    language?: string;
    edition?: string | null;
  };
  try {
    if (body.intent === "watch-now") {
      const year = body.year == null || body.year === "" ? null : Number(body.year);
      const identity: TitleIdentity = {
        mediaType: body.mediaType === "tv" ? "tv" : "movie",
        id: body.tmdbId ?? "",
        title: body.title ?? "",
        year: year != null && Number.isFinite(year) ? year : null,
        season: body.season ?? null,
        episode: body.episode ?? null,
        language: body.language?.trim() || "en",
        edition: body.edition ?? null,
      };
      if (!identity.id || !identity.title.trim()) {
        return NextResponse.json({ state: "unavailable", message: FAMILY_COPY.unavailable }, { status: 400 });
      }
      const plan = await decideWatchNow({
        identity,
        role: user.role === "owner" ? "owner" : "viewer",
        baseUrl: process.env.PROWLARR_URL,
        apiKey: process.env.PROWLARR_API_KEY,
      });
      return NextResponse.json({ state: plan.state, message: plan.message });
    }
    const placed = await placeTitleRequest({
      user,
      title: body.title ?? "",
      tmdbId: body.tmdbId,
      mediaType: body.mediaType,
      baseUrl: process.env.SEERR_URL,
      apiKey: process.env.SEERR_API_KEY,
    });
    return NextResponse.json({
      id: placed.id,
      reused: placed.reused,
      message: placed.message,
      seerr: placed.seerr,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Could not request that title.";
    const safe =
      raw === "Choose a title from the list." ||
      raw === "Enter a title." ||
      raw === "Account cannot request titles." ||
      raw === "Request quota is full."
        ? raw
        : FAMILY_COPY.failure;
    return NextResponse.json({ error: safe, message: safe }, { status: 400 });
  }
}
