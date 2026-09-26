import { NextResponse } from "next/server";
import { buildCatalogCards } from "@/src/lib/catalog";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { collectRankedKeys, FAMILY_COPY } from "@/src/lib/resolver";
import { listJellyfinLibrary } from "@/src/lib/services";
import { searchTmdb } from "@/src/lib/tmdb";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? "";
  const tmdb = await searchTmdb({ query, apiKey: process.env.TMDB_API_KEY });
  if (!tmdb.ok) {
    return NextResponse.json({ error: tmdb.error ?? "Search failed.", results: [] }, { status: 503 });
  }
  const jellyfin = await listJellyfinLibrary({
    baseUrl: process.env.JELLYFIN_URL,
    apiKey: process.env.JELLYFIN_API_KEY,
    publicBaseUrl: process.env.JELLYFIN_PUBLIC_URL,
  });
  const rankedKeys = await collectRankedKeys({
    hits: tmdb.results,
    role: user.role === "owner" ? "owner" : "viewer",
    baseUrl: process.env.PROWLARR_URL,
    apiKey: process.env.PROWLARR_API_KEY,
  }).catch(() => new Set<string>());
  return NextResponse.json({
    query: query.trim(),
    tmdbRole: "metadata",
    familyCopy: FAMILY_COPY,
    results: buildCatalogCards(tmdb.results, user, {
      jellyfin: jellyfin.items,
      rankedKeys,
    }),
  });
}
