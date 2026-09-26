import { NextResponse } from "next/server";
import { buildCatalogCards } from "@/src/lib/catalog";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
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
  return NextResponse.json({
    query: query.trim(),
    results: buildCatalogCards(tmdb.results, user),
  });
}
