import {
  listIndexerSources,
  listProwlarrIndexers,
  searchProwlarr,
  selectTestedIndexerIds,
  type ProwlarrRelease,
} from "./sources";

/** Family-facing sentences. No release, indexer, or codec jargon. */
export const FAMILY_COPY = {
  buffering: "Still loading. It will play when enough of the video is ready.",
  unavailable: "This isn't available to watch right now.",
  failure: "This didn't start. Try again in a little while, or request it.",
} as const;

export type TitleIdentity = {
  mediaType: "movie" | "tv";
  id: string;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  language: string;
  edition: string | null;
};

export type ReleaseCandidate = {
  title: string;
  indexerId: number;
  indexerName?: string;
  size: number;
  seeders: number;
  protocol?: string | null;
  files?: { path: string }[];
};

export type RankedCandidate = {
  identityKey: string;
  releaseTitle: string;
  indexerId: number;
  height: number;
  bytes: number;
  seeders: number;
  remux: boolean;
  watchNowSavePath: string;
  librarySavePath: string;
  score: number;
};

export type RankResult = {
  accepted: RankedCandidate[];
  rejected: { title: string; reason: string }[];
  best: RankedCandidate | null;
};

const GIB = 1024 * 1024 * 1024;

/** Family default: 1080p movies stay at or under 8 GiB. */
export const FAMILY_1080P_MOVIE_CAP_BYTES = 8 * GIB;

const ARCHIVE = /\.(rar|zip|7z|tar|gz|bz2|xz|iso|r\d{2})$/i;
const EXECUTABLE = /\.(exe|bat|cmd|com|msi|scr|dll|ps1|apk|dmg)$/i;
const VIDEO = /\.(mkv|mp4|m4v)$/i;
const UNSUPPORTED_VIDEO = /\.(avi|wmv|flv|mov|mpg|mpeg|ts|m2ts|vob)$/i;
const EXTRA = /\.(srt|ass|ssa|vtt|sub|idx|nfo|jpg|jpeg|png)$/i;
const BAD_TITLE = /\.(rar|zip|7z|tar|gz|bz2|xz|iso|exe|bat|cmd|msi|apk|dmg|avi|wmv|flv|mov|mpg|mpeg|ts)\b/i;

const LANGUAGE_TAGS: { code: string; pattern: RegExp }[] = [
  { code: "en", pattern: /\b(english|eng)\b/i },
  { code: "de", pattern: /\b(german|deutsch|ger)\b/i },
  { code: "fr", pattern: /\b(french|francais|français|truefrench|vostfr)\b/i },
  { code: "es", pattern: /\b(spanish|espanol|español|latino)\b/i },
  { code: "it", pattern: /\b(italian|ita)\b/i },
  { code: "ja", pattern: /\b(japanese)\b/i },
  { code: "ko", pattern: /\b(korean)\b/i },
  { code: "hi", pattern: /\b(hindi)\b/i },
  { code: "pt", pattern: /\b(portuguese)\b/i },
  { code: "ru", pattern: /\b(russian)\b/i },
  { code: "zh", pattern: /\b(chinese|mandarin)\b/i },
];

const EDITION_TAGS: { id: string; pattern: RegExp }[] = [
  { id: "extended", pattern: /\b(extended|unrated)\b/i },
  { id: "directors", pattern: /\b(directors|director'?s)\b/i },
  { id: "imax", pattern: /\bimax\b/i },
];

function cleanDir(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || "/";
}

/** qBittorrent library downloads and libtorrent Watch Now jobs never share a folder. */
export function resolveSavePaths(override?: { qbit?: string; watchNow?: string }): {
  qbit: string;
  watchNow: string;
} {
  const qbit = cleanDir(override?.qbit ?? process.env.QBIT_SAVE_PATH ?? "/mnt/downloads/qbit");
  const watchNow = cleanDir(override?.watchNow ?? process.env.WATCH_NOW_SAVE_PATH ?? "/mnt/downloads/watch-now");
  for (const dir of [qbit, watchNow]) {
    if (!dir.startsWith("/mnt/downloads/") && dir !== "/mnt/downloads") {
      throw new Error("Downloads may only be written under /mnt/downloads.");
    }
    if (dir === "/mnt/downloads") throw new Error("Downloads need their own folder under /mnt/downloads.");
    if (dir.split("/").some((part) => part === "..")) throw new Error("Download path is not allowed.");
  }
  if (qbit === watchNow) throw new Error("Download folders must stay separate.");
  if (qbit.startsWith(`${watchNow}/`) || watchNow.startsWith(`${qbit}/`)) {
    throw new Error("Download folders must not contain each other.");
  }
  return { qbit, watchNow };
}

export function identityKey(identity: TitleIdentity): string {
  return [
    identity.mediaType,
    identity.id.trim(),
    identity.year ?? "",
    identity.season ?? "",
    identity.episode ?? "",
    identity.language.trim().toLowerCase(),
    (identity.edition ?? "").trim().toLowerCase(),
  ].join(":");
}

export function identityFromCatalog(hit: {
  id: number | string;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
}): TitleIdentity {
  const year = hit.year ? Number(hit.year) : null;
  return {
    mediaType: hit.mediaType,
    id: String(hit.id),
    title: hit.title,
    year: year != null && Number.isFinite(year) ? year : null,
    season: null,
    episode: null,
    language: "en",
    edition: null,
  };
}

export function searchQuery(identity: TitleIdentity): string {
  if (identity.mediaType === "tv" && identity.season != null && identity.episode != null) {
    const season = String(identity.season).padStart(2, "0");
    const episode = String(identity.episode).padStart(2, "0");
    return `${identity.title} S${season}E${episode}`;
  }
  return identity.year ? `${identity.title} ${identity.year}` : identity.title;
}

function extension(file: string): string {
  const base = file.split(/[/\\]/).pop() ?? file;
  const index = base.lastIndexOf(".");
  if (index <= 0) return "";
  return base.slice(index).toLowerCase();
}

function unsafePath(file: string): boolean {
  if (!file || file.includes("\0")) return true;
  const normalized = file.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === "..")) return true;
  if (normalized.startsWith("/")) return true;
  if (/^[a-zA-Z]:/.test(file)) return true;
  return false;
}

function coreTokens(value: string): string[] {
  const stripped = value
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\bs\d{1,2}e\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}x\d{1,2}\b/g, " ")
    .replace(
      /\b(2160p|1080p|720p|480p|576p|4k|uhd|webrip|web-dl|webdl|web|bluray|blu-ray|bdrip|brrip|hdrip|dvdrip|hdtv|remux|x264|x265|h264|h265|hevc|aac|ddp|atmos|hdr10|hdr|sdr|proper|repack|extended|theatrical|directors?|unrated|imax|remastered|amzn|nf|dsnp|hmax|10bit|8bit|multi|english|eng|german|deutsch|french|spanish|italian|japanese|korean|hindi|portuguese|russian|chinese|mkv|mp4|m4v)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return stripped.split(/\s+/).filter(Boolean);
}

function titlesMatch(identityTitle: string, releaseTitle: string): boolean {
  const want = coreTokens(identityTitle);
  const got = coreTokens(releaseTitle);
  if (!want.length || got.length < want.length) return false;
  for (let i = 0; i < want.length; i += 1) {
    if (got[i] !== want[i]) return false;
  }
  return got.length - want.length <= 1;
}

function hasEpisode(name: string, season: number, episode: number): boolean {
  const pattern = /\bS(\d{1,2})E(\d{1,2})\b|\b(\d{1,2})x(\d{1,2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(name))) {
    const foundSeason = Number(match[1] ?? match[3]);
    const foundEpisode = Number(match[2] ?? match[4]);
    if (foundSeason === season && foundEpisode === episode) return true;
  }
  return false;
}

function resolution(name: string): { height: number; remux: boolean } | null {
  const remux = /\bremux\b/i.test(name);
  if (/\b(2160p|4k|uhd)\b/i.test(name)) return { height: 2160, remux };
  if (/\b1080p\b/i.test(name)) return { height: 1080, remux };
  if (/\b720p\b/i.test(name)) return { height: 720, remux };
  if (/\b(480p|576p)\b/i.test(name)) return { height: 480, remux };
  return null;
}

function sizeCap(identity: TitleIdentity, height: number, remux: boolean): number {
  const episode = identity.mediaType === "tv" && identity.episode != null;
  if (remux) return episode ? 15 * GIB : 60 * GIB;
  if (episode) {
    if (height >= 2160) return 8 * GIB;
    if (height >= 1080) return 3 * GIB;
    if (height >= 720) return Math.floor(1.5 * GIB);
    return GIB;
  }
  if (height >= 2160) return 25 * GIB;
  if (height >= 1080) return FAMILY_1080P_MOVIE_CAP_BYTES;
  if (height >= 720) return 4 * GIB;
  return 2 * GIB;
}

function languageOk(name: string, language: string): boolean {
  const wanted = language.trim().toLowerCase();
  const wantedTag = LANGUAGE_TAGS.find((item) => item.code === wanted);
  const foreign = LANGUAGE_TAGS.filter((item) => item.code !== wanted);
  const multi = /\bmulti\b/i.test(name);
  const wantedHit = wantedTag ? wantedTag.pattern.test(name) : false;
  const foreignHit = foreign.some((item) => item.pattern.test(name)) || (multi && !wantedHit);
  if (foreignHit && !wantedHit) return false;
  if (wantedTag && !wantedHit && foreignHit) return false;
  if (wanted !== "en" && wantedTag && !wantedHit && !foreignHit) return false;
  return true;
}

function editionOk(name: string, edition: string | null): boolean {
  const wanted = (edition ?? "theatrical").trim().toLowerCase();
  const hits = EDITION_TAGS.filter((item) => item.pattern.test(name)).map((item) => item.id);
  if (wanted === "theatrical" || wanted === "") return hits.length === 0;
  if (!hits.includes(wanted)) return false;
  return hits.every((item) => item === wanted);
}

function fileProblem(release: ReleaseCandidate): string | null {
  const listed = release.files ?? [];
  if (!listed.length) {
    if (BAD_TITLE.test(release.title) || ARCHIVE.test(release.title) || EXECUTABLE.test(release.title)) {
      if (EXECUTABLE.test(release.title)) return "executable";
      if (ARCHIVE.test(release.title) || /\.(rar|zip|7z|iso)\b/i.test(release.title)) return "archive";
      return "unsupported-format";
    }
    return null;
  }
  const videos: string[] = [];
  for (const file of listed) {
    const path = file.path;
    if (unsafePath(path)) return "unsafe-path";
    if (EXECUTABLE.test(path)) return "executable";
    if (ARCHIVE.test(path)) return "archive";
    if (UNSUPPORTED_VIDEO.test(path)) return "unsupported-format";
    if (VIDEO.test(path)) {
      videos.push(path);
      continue;
    }
    if (EXTRA.test(path)) continue;
    return "unexpected-files";
  }
  if (videos.length !== 1) return videos.length === 0 ? "unsupported-format" : "unexpected-files";
  if (/sample/i.test(videos[0]!)) return "unexpected-files";
  return null;
}

function rejectRelease(
  identity: TitleIdentity,
  release: ReleaseCandidate,
  testedIndexerIds: number[],
  role: "owner" | "viewer",
): string | null {
  if (!identity.id.trim()) return "missing-id";
  if (!testedIndexerIds.includes(release.indexerId)) return "indexer-not-tested";
  if (release.protocol && release.protocol.toLowerCase() !== "torrent") return "unsupported-format";
  const files = fileProblem(release);
  if (files) return files;
  if (!titlesMatch(identity.title, release.title)) return "mismatched-title";
  if (identity.year != null) {
    const years: string[] = release.title.match(/\b(?:19|20)\d{2}\b/g) ?? [];
    if (!years.includes(String(identity.year)) || years.some((year) => year !== String(identity.year))) {
      return "mismatched-year";
    }
  }
  if (identity.mediaType === "tv" && identity.season != null && identity.episode != null) {
    if (!hasEpisode(release.title, identity.season, identity.episode)) return "mismatched-episode";
  }
  if (!languageOk(release.title, identity.language || "en")) return "mismatched-language";
  if (!editionOk(release.title, identity.edition)) return "mismatched-edition";
  const picture = resolution(release.title);
  if (!picture) return "unsupported-format";
  if ((picture.height >= 2160 || picture.remux) && role !== "owner") return "owner-only";
  if (release.size <= 0) return "unexpected-files";
  if (release.size > sizeCap(identity, picture.height, picture.remux)) return "size-cap";
  return null;
}

function scoreOf(height: number, seeders: number, bytes: number, cap: number, remux: boolean): number {
  const preference = height === 1080 ? 1000 : height === 720 ? 600 : height === 480 ? 300 : 200;
  return preference + Math.min(seeders, 500) - bytes / cap - (remux ? 400 : 0);
}

export function rankCandidates(input: {
  identity: TitleIdentity;
  releases: ReleaseCandidate[];
  testedIndexerIds: number[];
  role: "owner" | "viewer";
  savePaths?: { qbit?: string; watchNow?: string };
}): RankResult {
  const paths = resolveSavePaths(input.savePaths);
  const accepted: RankedCandidate[] = [];
  const rejected: { title: string; reason: string }[] = [];
  for (const release of input.releases) {
    const reason = rejectRelease(input.identity, release, input.testedIndexerIds, input.role);
    if (reason) {
      rejected.push({ title: release.title, reason });
      continue;
    }
    const picture = resolution(release.title)!;
    const cap = sizeCap(input.identity, picture.height, picture.remux);
    accepted.push({
      identityKey: identityKey(input.identity),
      releaseTitle: release.title,
      indexerId: release.indexerId,
      height: picture.height,
      bytes: release.size,
      seeders: release.seeders,
      remux: picture.remux,
      watchNowSavePath: paths.watchNow,
      librarySavePath: paths.qbit,
      score: scoreOf(picture.height, release.seeders, release.size, cap, picture.remux),
    });
  }
  accepted.sort((a, b) => b.score - a.score);
  return { accepted, rejected, best: accepted[0] ?? null };
}

export type WatchNowPlan = {
  state: "buffering" | "unavailable" | "failure";
  message: string;
  candidateAccepted: boolean;
  started: false;
  watchNowSavePath?: string;
  librarySavePath?: string;
};

/**
 * Chooses Watch Now only from tested indexers.
 * This does not download a payload and does not import anything into the library.
 */
export async function decideWatchNow(input: {
  identity: TitleIdentity;
  role: "owner" | "viewer";
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  savePaths?: { qbit?: string; watchNow?: string };
}): Promise<WatchNowPlan> {
  let paths: { qbit: string; watchNow: string };
  try {
    paths = resolveSavePaths(input.savePaths);
  } catch {
    return { state: "failure", message: FAMILY_COPY.failure, candidateAccepted: false, started: false };
  }
  const tested = listIndexerSources().filter((item) => item.tested);
  if (!tested.length || !input.baseUrl || !input.apiKey) {
    return { state: "unavailable", message: FAMILY_COPY.unavailable, candidateAccepted: false, started: false };
  }
  const remote = await listProwlarrIndexers({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  const indexerIds = selectTestedIndexerIds(tested, remote.indexers);
  if (!indexerIds.length) {
    return { state: "unavailable", message: FAMILY_COPY.unavailable, candidateAccepted: false, started: false };
  }
  const found = await searchProwlarr({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    query: searchQuery(input.identity),
    indexerIds,
    fetchImpl: input.fetchImpl,
  });
  if (!found.ok) {
    return { state: "failure", message: FAMILY_COPY.failure, candidateAccepted: false, started: false };
  }
  const ranked = rankCandidates({
    identity: input.identity,
    releases: found.releases,
    testedIndexerIds: indexerIds,
    role: input.role,
    savePaths: paths,
  });
  if (!ranked.best) {
    return { state: "unavailable", message: FAMILY_COPY.unavailable, candidateAccepted: false, started: false };
  }
  if (ranked.best.watchNowSavePath === ranked.best.librarySavePath) {
    return { state: "failure", message: FAMILY_COPY.failure, candidateAccepted: false, started: false };
  }
  return {
    state: "failure",
    message: FAMILY_COPY.failure,
    candidateAccepted: true,
    started: false,
    watchNowSavePath: ranked.best.watchNowSavePath,
    librarySavePath: ranked.best.librarySavePath,
  };
}

export async function collectRankedKeys(input: {
  hits: { id: number | string; mediaType: "movie" | "tv"; title: string; year: string | null }[];
  role: "owner" | "viewer";
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!input.baseUrl || !input.apiKey) return keys;
  let paths: { qbit: string; watchNow: string };
  try {
    paths = resolveSavePaths();
  } catch {
    return keys;
  }
  const local = listIndexerSources();
  if (!local.some((item) => item.tested)) return keys;
  const remote = await listProwlarrIndexers({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  const indexerIds = selectTestedIndexerIds(local, remote.indexers);
  if (!indexerIds.length) return keys;
  for (const hit of input.hits) {
    const identity = identityFromCatalog(hit);
    const found = await searchProwlarr({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      query: searchQuery(identity),
      indexerIds,
      fetchImpl: input.fetchImpl,
    });
    if (!found.ok) continue;
    const ranked = rankCandidates({
      identity,
      releases: found.releases,
      testedIndexerIds: indexerIds,
      role: input.role,
      savePaths: paths,
    });
    if (ranked.best) keys.add(identityKey(identity));
  }
  return keys;
}

export function releaseFromProwlarr(release: ProwlarrRelease): ReleaseCandidate {
  return {
    title: release.title,
    indexerId: release.indexerId,
    indexerName: release.indexerName,
    size: release.size,
    seeders: release.seeders,
    protocol: release.protocol,
    files: release.files,
  };
}
