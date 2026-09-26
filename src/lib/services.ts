import type { UserRow } from "./db";
import { getServiceLink, saveServiceLink } from "./db";
import { createRequest, findRequestByTmdb, saveSeerrRequest } from "./media";
import { FAMILY_COPY } from "./resolver";

type FetchLike = typeof fetch;

export async function syncJellyfin(input: {
  user: UserRow;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; error?: string; externalId?: string }> {
  if (!input.baseUrl || !input.apiKey) {
    saveServiceLink(input.user.id, "jellyfin", null, "Jellyfin is not configured.");
    return { ok: false, error: "Jellyfin is not configured." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const disabled = input.user.status === "suspended" || input.user.status === "revoked";
  const root = input.baseUrl.replace(/\/$/, "");
  const headers = { "X-Emby-Token": input.apiKey, "Content-Type": "application/json" };
  try {
    const storedId = getServiceLink(input.user.id, "jellyfin");
    const prior = await fetchImpl(`${root}/Users`, {
      headers: { "X-Emby-Token": input.apiKey },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    let externalId: string | null = storedId;
    if (prior?.ok) {
      const users = (await prior.json()) as { Id?: string; Name?: string }[];
      const match = users.find((item) => (storedId && item.Id === storedId) || item.Name === input.user.id);
      externalId = match?.Id ?? null;
    }
    if (externalId) {
      const policyResponse = await fetchImpl(`${root}/Users/${externalId}/Policy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ IsDisabled: disabled }),
        signal: AbortSignal.timeout(5000),
      });
      if (!policyResponse.ok) {
        const error = `Jellyfin HTTP ${policyResponse.status}`;
        saveServiceLink(input.user.id, "jellyfin", externalId, error);
        return { ok: false, error };
      }
      saveServiceLink(input.user.id, "jellyfin", externalId, null);
      return { ok: true, externalId };
    }
    if (disabled) {
      saveServiceLink(input.user.id, "jellyfin", null, null);
      return { ok: true };
    }
    const response = await fetchImpl(`${root}/Users/New`, {
      method: "POST",
      headers,
      body: JSON.stringify({ Name: input.user.id, Policy: { IsDisabled: false } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const error = `Jellyfin HTTP ${response.status}`;
      saveServiceLink(input.user.id, "jellyfin", null, error);
      return { ok: false, error };
    }
    const body = (await response.json()) as { Id?: string };
    externalId = body.Id ?? null;
    saveServiceLink(input.user.id, "jellyfin", externalId, null);
    return { ok: true, externalId: externalId ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Jellyfin sync failed.";
    saveServiceLink(input.user.id, "jellyfin", null, message);
    return { ok: false, error: message };
  }
}

export async function syncSeerr(input: {
  user: UserRow;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; error?: string; externalId?: string }> {
  if (!input.baseUrl || !input.apiKey) {
    saveServiceLink(input.user.id, "seerr", null, "Seerr is not configured.");
    return { ok: false, error: "Seerr is not configured." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/api/v1/user`, {
      method: "POST",
      headers: {
        "X-Api-Key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.user.email,
        permissions: input.user.role === "owner" ? 2 : 32,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const error = `Seerr HTTP ${response.status}`;
      saveServiceLink(input.user.id, "seerr", null, error);
      return { ok: false, error };
    }
    const body = (await response.json()) as { id?: number };
    const externalId = body.id != null ? String(body.id) : null;
    saveServiceLink(input.user.id, "seerr", externalId, null);
    return { ok: true, externalId: externalId ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seerr sync failed.";
    saveServiceLink(input.user.id, "seerr", null, message);
    return { ok: false, error: message };
  }
}

export type JellyfinBrowseItem = {
  id: string;
  title: string;
  year: string | null;
  type: "Movie" | "Series" | "Episode" | string;
  imageUrl: string | null;
  playUrl: string | null;
};

export async function listJellyfinLibrary(input: {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  publicBaseUrl?: string;
  limit?: number;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; items: JellyfinBrowseItem[]; error?: string }> {
  if (!input.baseUrl || !input.apiKey) {
    return { ok: false, items: [], error: "Jellyfin is not configured." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const root = input.baseUrl.replace(/\/$/, "");
  const publicRoot = (input.publicBaseUrl ?? "https://media.hasnain.us").replace(/\/$/, "");
  const limit = input.limit ?? 24;
  try {
    const response = await fetchImpl(
      `${root}/Items?Recursive=true&IncludeItemTypes=Movie,Series&SortBy=DateCreated&SortOrder=Descending&Limit=${limit}&Fields=ProductionYear,PrimaryImageTag,Type`,
      {
        headers: { "X-Emby-Token": input.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      return { ok: false, items: [], error: `Jellyfin HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      Items?: {
        Id?: string;
        Name?: string;
        ProductionYear?: number;
        Type?: string;
        ImageTags?: { Primary?: string };
      }[];
    };
    const items: JellyfinBrowseItem[] = (body.Items ?? [])
      .filter((item) => item.Id && item.Name)
      .map((item) => ({
        id: item.Id!,
        title: item.Name!,
        year: item.ProductionYear ? String(item.ProductionYear) : null,
        type: item.Type ?? "Unknown",
        imageUrl: item.ImageTags?.Primary
          ? `${root}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}`
          : null,
        playUrl: `${publicRoot}/web/index.html#!/details?id=${item.Id}`,
      }));
    return { ok: true, items };
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : "Jellyfin browse failed.",
    };
  }
}

type SeerrHit = { id?: number; mediaType?: string; title?: string; season?: number | null };

async function lookupSeerrRequestId(
  fetchImpl: FetchLike,
  root: string,
  apiKey: string,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<string | null> {
  const path = mediaType === "tv" ? "tv" : "movie";
  const response = await fetchImpl(`${root}/api/v1/${path}/${encodeURIComponent(tmdbId)}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    mediaInfo?: { requests?: { id?: number }[] };
    requests?: { id?: number }[];
  };
  const fromMedia = body.mediaInfo?.requests?.find((item) => item.id != null)?.id;
  const fromTop = body.requests?.find((item) => item.id != null)?.id;
  const id = fromMedia ?? fromTop;
  return id != null ? String(id) : null;
}

/** Create a Seerr request for a TMDB id. A repeat call reuses the existing request. */
export async function requestTitleInSeerr(input: {
  title: string;
  tmdbId?: string;
  mediaType?: "movie" | "tv";
  season?: number | null;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; error?: string; externalId?: string; mediaType?: string; reused?: boolean }> {
  if (!input.baseUrl || !input.apiKey) {
    return { ok: false, error: "Seerr is not configured." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const root = input.baseUrl.replace(/\/$/, "");
  try {
    let hit: SeerrHit | undefined;
    if (input.tmdbId && input.mediaType) {
      const mediaId = Number(input.tmdbId);
      if (!Number.isFinite(mediaId)) return { ok: false, error: "A catalog id is required." };
      const existing = await lookupSeerrRequestId(fetchImpl, root, input.apiKey, input.tmdbId, input.mediaType).catch(
        () => null,
      );
      if (existing) return { ok: true, externalId: existing, mediaType: input.mediaType, reused: true };
      hit = { id: mediaId, mediaType: input.mediaType, title: input.title, season: input.season };
    } else {
      const search = await fetchImpl(`${root}/api/v1/search?query=${encodeURIComponent(input.title)}&page=1`, {
        headers: { "X-Api-Key": input.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!search.ok) return { ok: false, error: `Seerr search HTTP ${search.status}` };
      const found = (await search.json()) as { results?: SeerrHit[] };
      hit = (found.results ?? []).find((item) => item.id != null && item.mediaType);
    }
    if (!hit?.id || !hit.mediaType) return { ok: false, error: "Seerr has no match for that title." };
    const payload: { mediaType: string; mediaId: number; seasons?: "all" | number[] } = {
      mediaType: hit.mediaType,
      mediaId: hit.id,
    };
    if (hit.mediaType === "tv") payload.seasons = hit.season != null ? [hit.season] : "all";
    const created = await fetchImpl(`${root}/api/v1/request`, {
      method: "POST",
      headers: { "X-Api-Key": input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (created.status === 409 && input.tmdbId && input.mediaType) {
      const existing = await lookupSeerrRequestId(fetchImpl, root, input.apiKey, input.tmdbId, input.mediaType).catch(
        () => null,
      );
      if (existing) return { ok: true, externalId: existing, mediaType: input.mediaType, reused: true };
    }
    if (!created.ok) return { ok: false, error: `Seerr request HTTP ${created.status}` };
    const body = (await created.json()) as { id?: number };
    if (body.id == null) return { ok: false, error: "Seerr did not return a request id." };
    return { ok: true, externalId: String(body.id), mediaType: hit.mediaType, reused: false };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Seerr request failed." };
  }
}

export async function placeTitleRequest(input: {
  user: UserRow;
  title: string;
  tmdbId?: string;
  mediaType?: "movie" | "tv";
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<{
  id: string;
  reused: boolean;
  message: string;
  seerr: { ok: boolean; externalId?: string; reused?: boolean };
}> {
  if (!input.tmdbId || (input.mediaType !== "movie" && input.mediaType !== "tv")) {
    throw new Error("Choose a title from the list.");
  }
  const existing = findRequestByTmdb(input.user.id, input.tmdbId, input.mediaType);
  if (existing?.seerrRequestId) {
    return {
      id: existing.id,
      reused: true,
      message: `"${input.title}" is already on the household list.`,
      seerr: { ok: true, externalId: existing.seerrRequestId, reused: true },
    };
  }
  const created = existing ?? createRequest(input.user, input.title, { tmdbId: input.tmdbId, mediaType: input.mediaType });
  const seerr = await requestTitleInSeerr({
    title: input.title,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  if (seerr.externalId) saveSeerrRequest(created.id, seerr.externalId, null);
  const reused = Boolean(existing) || Boolean(seerr.reused);
  let message: string = FAMILY_COPY.failure;
  if (seerr.ok && reused) message = `"${input.title}" is already on the household list.`;
  else if (seerr.ok) message = `"${input.title}" was sent to the household list.`;
  else if (seerr.error === "Seerr is not configured.") {
    message = `"${input.title}" was saved here. It will be requested when the house list is connected.`;
  }
  return {
    id: created.id,
    reused,
    message,
    seerr: { ok: seerr.ok, externalId: seerr.externalId, reused: seerr.reused },
  };
}
