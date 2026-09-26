import type { UserRow } from "./db";
import { getDb } from "./db";
import { listMedia } from "./media";
import type { MediaRow } from "./media";
import { identityFromCatalog, identityKey } from "./resolver";
import type { TmdbHit } from "./tmdb";
import { tmdbPosterUrl } from "./tmdb";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchJellyfin<T extends { title: string; year: string | null }>(
  hit: { title: string; year: string | null },
  items: T[],
): T | undefined {
  const key = normalizeTitle(hit.title);
  return items.find((item) => {
    if (normalizeTitle(item.title) !== key) return false;
    if (hit.year && item.year && hit.year !== item.year) return false;
    return true;
  });
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

export type WatchAction = "library" | "watch-now" | "request";

export type CatalogCard = TmdbHit & {
  posterUrl: string | null;
  /** True only when the household library can play it. A TMDB hit is never enough. */
  playable: boolean;
  discoverable: boolean;
  mediaId: string | null;
  requestState: string | null;
  action: WatchAction;
  playUrl: string | null;
  notice: "buffering" | "unavailable" | "failure" | null;
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

export function buildCatalogCards(
  hits: TmdbHit[],
  user: UserRow,
  extras?: {
    jellyfin?: { title: string; year: string | null; playUrl: string | null }[];
    rankedKeys?: ReadonlySet<string>;
  },
): CatalogCard[] {
  const library = listMedia();
  const jellyfin = extras?.jellyfin ?? [];
  const ranked = extras?.rankedKeys ?? new Set<string>();
  return hits.map((hit) => {
    const local = matchLocalMedia(hit, library);
    const pending = requestForTmdb(user.id, hit);
    const inLibrary = matchJellyfin(hit, jellyfin);
    const rankedKey = identityKey(identityFromCatalog(hit));
    let action: WatchAction = "request";
    let playUrl: string | null = null;
    let mediaId: string | null = null;
    if (inLibrary?.playUrl) {
      action = "library";
      playUrl = inLibrary.playUrl;
    } else if (local) {
      action = "watch-now";
      mediaId = local.id;
    } else if (ranked.has(rankedKey)) {
      action = "watch-now";
    }
    return {
      ...hit,
      posterUrl: tmdbPosterUrl(hit.posterPath),
      playable: action === "library",
      discoverable: action === "request",
      mediaId,
      requestState: pending?.state ?? null,
      action,
      playUrl,
      notice: pending?.state === "failed" ? "unavailable" : null,
    };
  });
}
