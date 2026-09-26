import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FAMILY_1080P_MOVIE_CAP_BYTES,
  FAMILY_COPY,
  identityKey,
  rankCandidates,
  resolveSavePaths,
  type ReleaseCandidate,
  type TitleIdentity,
} from "../src/lib/resolver";

const paths = { qbit: "/mnt/downloads/qbit", watchNow: "/mnt/downloads/watch-now" };
const GIB = 1024 * 1024 * 1024;

const dune: TitleIdentity = {
  mediaType: "movie",
  id: "693134",
  title: "Dune: Part Two",
  year: 2024,
  season: null,
  episode: null,
  language: "en",
  edition: null,
};

function release(overrides: Partial<ReleaseCandidate> & { title: string }): ReleaseCandidate {
  return {
    indexerId: 2,
    size: 4 * GIB,
    seeders: 10,
    protocol: "torrent",
    ...overrides,
  };
}

function reasons(releases: ReleaseCandidate[], role: "owner" | "viewer" = "viewer", identity: TitleIdentity = dune) {
  return rankCandidates({
    identity,
    releases,
    testedIndexerIds: [2],
    role,
    savePaths: paths,
  });
}

test("identity key keeps movie id, year, episode, language, and edition", () => {
  const episode: TitleIdentity = {
    mediaType: "tv",
    id: "1396",
    title: "Breaking Bad",
    year: 2008,
    season: 1,
    episode: 1,
    language: "en",
    edition: "extended",
  };
  const key = identityKey(episode);
  assert.match(key, /tv:1396:2008:1:1:en:extended/);
  assert.notEqual(key, identityKey({ ...episode, episode: 2 }));
  assert.notEqual(key, identityKey({ ...episode, language: "de" }));
  assert.notEqual(key, identityKey({ ...episode, edition: null }));
});

test("family default prefers a size-capped 1080p release and keeps save folders apart", () => {
  const ranked = reasons([
    release({ title: "Dune.Part.Two.2024.2160p.WEB.x265-FLUX", size: 18 * GIB, seeders: 80 }),
    release({ title: "Dune.Part.Two.2024.1080p.REMUX.x264-FLUX", size: 20 * GIB, seeders: 40 }),
    release({ title: "Dune.Part.Two.2024.1080p.WEB.x264-FLUX", seeders: 12 }),
    release({ title: "Dune.Part.Two.2024.720p.WEB.x264-FLUX", size: 2 * GIB, seeders: 30 }),
  ]);
  assert.equal(ranked.best?.height, 1080);
  assert.equal(ranked.best?.remux, false);
  assert.ok(ranked.best && ranked.best.bytes <= FAMILY_1080P_MOVIE_CAP_BYTES);
  assert.notEqual(ranked.best?.watchNowSavePath, ranked.best?.librarySavePath);
  assert.equal(ranked.best?.watchNowSavePath, paths.watchNow);
  assert.equal(ranked.best?.librarySavePath, paths.qbit);
  assert.ok(ranked.rejected.some((item) => item.reason === "owner-only"));
});

test("2160p and remux stay owner-only, and 1080p still wins for the owner", () => {
  const owner = reasons(
    [
      release({ title: "Dune.Part.Two.2024.2160p.WEB.x265-FLUX", size: 18 * GIB, seeders: 90 }),
      release({ title: "Dune.Part.Two.2024.1080p.WEB.x264-FLUX", seeders: 5 }),
    ],
    "owner",
  );
  assert.equal(owner.best?.height, 1080);
  const onlyLarge = reasons(
    [release({ title: "Dune.Part.Two.2024.2160p.REMUX.x265-FLUX", size: 40 * GIB, seeders: 4 })],
    "owner",
  );
  assert.equal(onlyLarge.best?.height, 2160);
  assert.equal(onlyLarge.best?.remux, true);
  const family = reasons([
    release({ title: "Dune.Part.Two.2024.2160p.REMUX.x265-FLUX", size: 40 * GIB, seeders: 4 }),
  ]);
  assert.equal(family.best, null);
  assert.equal(family.rejected[0]?.reason, "owner-only");
});

test("rejects unsafe, archived, executable, mismatched, and unsupported releases", () => {
  const ranked = reasons([
    release({ title: "Dune.Part.Two.2024.1080p.WEB.mkv", files: [{ path: "../secret.mkv" }] }),
    release({ title: "Dune.Part.Two.2024.1080p.rar" }),
    release({ title: "Dune.Part.Two.2024.1080p.exe" }),
    release({ title: "Blade.Runner.2049.1080p.WEB.mkv" }),
    release({ title: "Dune.Part.Two.2024.GERMAN.1080p.WEB.mkv" }),
    release({ title: "Dune.Part.Two.2024.EXTENDED.1080p.WEB.mkv" }),
    release({ title: "Dune.Part.Two.2023.1080p.WEB.mkv" }),
    release({
      title: "Dune.Part.Two.2024.1080p.WEB.mkv",
      files: [{ path: "Dune.Part.Two.2024.1080p.avi" }],
    }),
    release({
      title: "Dune.Part.Two.2024.1080p.WEB.mkv",
      files: [{ path: "feature.mkv" }, { path: "notes.txt" }],
    }),
    release({ title: "Dune.Part.Two.2024.1080p.WEB.mkv", indexerId: 9 }),
    release({ title: "Dune.Part.Two.2024.1080p.WEB.mkv", size: 9 * GIB }),
  ]);
  const found = ranked.rejected.map((item) => item.reason);
  for (const reason of [
    "unsafe-path",
    "archive",
    "executable",
    "mismatched-title",
    "mismatched-language",
    "mismatched-edition",
    "mismatched-year",
    "unsupported-format",
    "unexpected-files",
    "indexer-not-tested",
    "size-cap",
  ]) {
    assert.ok(found.includes(reason), reason);
  }
  assert.equal(ranked.best, null);
});

test("tv identity requires the requested episode", () => {
  const show: TitleIdentity = {
    mediaType: "tv",
    id: "1396",
    title: "Breaking Bad",
    year: 2008,
    season: 1,
    episode: 2,
    language: "en",
    edition: null,
  };
  const ranked = reasons(
    [
      release({ title: "Breaking.Bad.S01E03.2008.1080p.WEB.mkv", size: 2 * GIB }),
      release({ title: "Breaking.Bad.S01E02.2008.1080p.WEB.mkv", size: 2 * GIB }),
    ],
    "viewer",
    show,
  );
  assert.match(ranked.best?.releaseTitle ?? "", /S01E02/);
  assert.ok(ranked.rejected.some((item) => item.reason === "mismatched-episode"));
});

test("download folders cannot be the same path or nested", () => {
  assert.throws(() => resolveSavePaths({ qbit: "/mnt/downloads/qbit", watchNow: "/mnt/downloads/qbit" }), /separate/);
  assert.throws(
    () => resolveSavePaths({ qbit: "/mnt/downloads/qbit", watchNow: "/mnt/downloads/qbit/watch" }),
    /contain/,
  );
  assert.throws(() => resolveSavePaths({ qbit: "/var/tmp/qbit", watchNow: "/mnt/downloads/watch-now" }), /mnt\/downloads/);
  const defaults = resolveSavePaths({ qbit: undefined, watchNow: undefined });
  delete process.env.QBIT_SAVE_PATH;
  delete process.env.WATCH_NOW_SAVE_PATH;
  const fromEnv = resolveSavePaths();
  assert.equal(fromEnv.qbit, "/mnt/downloads/qbit");
  assert.equal(fromEnv.watchNow, "/mnt/downloads/watch-now");
  assert.notEqual(defaults.qbit, defaults.watchNow);
});

test("family copy stays free of release jargon", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const blob = `${page}\n${FAMILY_COPY.buffering}\n${FAMILY_COPY.unavailable}\n${FAMILY_COPY.failure}`;
  assert.match(page, new RegExp(FAMILY_COPY.buffering.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, new RegExp(FAMILY_COPY.unavailable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, new RegExp(FAMILY_COPY.failure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(blob, /torrent|indexer|codec|prowlarr|remux|x264|x265|mkv|1080|2160|qbit/i);
});
