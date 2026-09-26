import type { UserRow } from "./db";
import { getDb } from "./db";
import { listMedia } from "./media";
import type { MediaRow } from "./media";
import type { TmdbHit } from "./tmdb";
import { tmdbPosterUrl } from "./tmdb";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchLocalMedia(hit: TmdbHit, library: MediaRow[]): MediaRow | undefined {
  const key = normalizeTitle(hit.title);
  const year = hit.year;
  return library.find((row) => {
    if (row.request_state !== "available") return false;
    const rowKey = normalizeTitle(row.title);
    if (rowKey !== key && !rowKey.startsWith(key) && !key.startsWith(rowKey)) return false;
    if (year && row.title.includes(year)) return true;
    return rowKey === key;
  });
}

export type CatalogCard = TmdbHit & {
  posterUrl: string | null;
  playable: boolean;
  discoverable: boolean;
  mediaId: string | null;
  requestState: string | null;
};

function requestForTmdb(userId: string, hit: TmdbHit): { state: string } | undefined {
  const row = getDb()
    .prepare(
      `SELECT state FROM media_requests
       WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId, String(hit.id), hit.mediaType) as { state: string } | undefined;
  return row;
}

export function buildCatalogCards(hits: TmdbHit[], user: UserRow): CatalogCard[] {
  const library = listMedia();
  return hits.map((hit) => {
    const local = matchLocalMedia(hit, library);
    const pending = requestForTmdb(user.id, hit);
    const playable = Boolean(local);
    return {
      ...hit,
      posterUrl: tmdbPosterUrl(hit.posterPath),
      playable,
      discoverable: !playable,
      mediaId: local?.id ?? null,
      requestState: pending?.state ?? null,
    };
  });
}
