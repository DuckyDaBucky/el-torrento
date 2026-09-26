import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL, decideFirstContact } from "../src/lib/access";
import { buildCatalogCards } from "../src/lib/catalog";
import { bootstrapOwner, getDb, resetDbForTests, type UserRow } from "../src/lib/db";
import { listRequests } from "../src/lib/media";
import { decideWatchNow, FAMILY_COPY, identityFromCatalog, identityKey } from "../src/lib/resolver";
import { placeTitleRequest, requestTitleInSeerr, syncJellyfin } from "../src/lib/services";

const GIB = 1024 * 1024 * 1024;

describe("family watch loop", () => {
  let server: Server;
  let base: string;
  let posts = 0;
  let seerrId: number | null = null;
  let requestBody: { mediaType?: string; mediaId?: number } | null = null;
  let creates = 0;
  const policies: { url: string; body: { IsDisabled?: boolean } }[] = [];
  const jellyfinUsers: { Id: string; Name: string }[] = [];

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "el-torrento-watch-"));
    process.env.ELTORRENTO_DB = path.join(dir, "app.sqlite");
    delete process.env.QBIT_SAVE_PATH;
    delete process.env.WATCH_NOW_SAVE_PATH;
    resetDbForTests();
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        const body = raw
          ? (JSON.parse(raw) as { IsDisabled?: boolean; Name?: string; mediaType?: string; mediaId?: number })
          : {};
        const url = req.url ?? "";
        if (req.method === "GET" && url === "/api/v1/movie/550") {
          res.writeHead(seerrId == null ? 404 : 200, { "Content-Type": "application/json" });
          res.end(seerrId == null ? "" : JSON.stringify({ mediaInfo: { requests: [{ id: seerrId }] } }));
          return;
        }
        if (req.method === "POST" && url === "/api/v1/request") {
          posts += 1;
          requestBody = body;
          seerrId = 42;
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: seerrId }));
          return;
        }
        if (req.method === "GET" && url === "/Users") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(jellyfinUsers));
          return;
        }
        if (req.method === "POST" && url === "/Users/New") {
          creates += 1;
          jellyfinUsers.push({ Id: "jf_user_1", Name: body.Name ?? "" });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ Id: "jf_user_1", Name: body.Name }));
          return;
        }
        if (req.method === "POST" && url.endsWith("/Policy")) {
          policies.push({ url, body });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
          return;
        }
        if (req.method === "GET" && url.startsWith("/api/v1/indexer")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([{ id: 2, name: "EZTV", definitionName: "eztv" }, { id: 9, name: "Nyaa", definitionName: "nyaa" }]));
          return;
        }
        if (req.method === "GET" && url.startsWith("/api/v1/search")) {
          assert.match(url, /indexerIds=2/);
          assert.doesNotMatch(url, /indexerIds=9/);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify([
              {
                title: "Dune.Part.Two.2024.1080p.WEB.x264-FLUX",
                indexerId: 2,
                indexer: "EZTV",
                size: 4 * GIB,
                seeders: 15,
                protocol: "torrent",
              },
            ]),
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    base = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
    resetDbForTests();
    delete process.env.ELTORRENTO_DB;
  });

  it("keeps owner bootstrap on the verified Google account, then the Clerk user id", () => {
    const decision = decideFirstContact({
      owner: null,
      identity: { clerkUserId: "user_owner_watch", email: BOOTSTRAP_OWNER_EMAIL, emailVerified: true },
      invitedEmail: null,
    });
    assert.equal(decision.action, "bind-owner");
    assert.equal(BOOTSTRAP_OWNER_EMAIL, "hasnainmn7@gmail.com");
    const access = readFileSync(new URL("../src/lib/access.ts", import.meta.url), "utf8");
    const emails = access.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    assert.deepEqual(emails, [BOOTSTRAP_OWNER_EMAIL]);
  });

  it("reuses a mock Seerr request for the same TMDB id and does not import a file", async () => {
    const owner = bootstrapOwner({
      clerkUserId: "user_owner_watch",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(owner.ok, true);
    if (!owner.ok) return;

    const first = await requestTitleInSeerr({
      title: "Fight Club",
      tmdbId: "550",
      mediaType: "movie",
      baseUrl: base,
      apiKey: "mock-key",
    });
    const second = await requestTitleInSeerr({
      title: "Fight Club",
      tmdbId: "550",
      mediaType: "movie",
      baseUrl: base,
      apiKey: "mock-key",
    });
    assert.equal(first.ok, true);
    assert.equal(first.externalId, "42");
    assert.equal(first.reused, false);
    assert.deepEqual(requestBody, { mediaType: "movie", mediaId: 550 });
    assert.equal(second.reused, true);
    assert.equal(second.externalId, "42");
    assert.equal(posts, 1);

    const placed = await placeTitleRequest({
      user: owner.user,
      title: "Fight Club",
      tmdbId: "550",
      mediaType: "movie",
      baseUrl: base,
      apiKey: "mock-key",
    });
    const again = await placeTitleRequest({
      user: owner.user,
      title: "Fight Club",
      tmdbId: "550",
      mediaType: "movie",
      baseUrl: base,
      apiKey: "mock-key",
    });
    assert.equal(posts, 1);
    assert.equal(again.reused, true);
    assert.equal(again.id, placed.id);
    const rows = listRequests();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tmdbId, "550");
    assert.equal(rows[0]?.seerrRequestId, "42");
    assert.equal(rows[0]?.state, "resolving");
  });

  it("creates a Jellyfin user once and disables that same user on revoke", async () => {
    const viewer = {
      id: "usr_viewer_watch",
      clerk_user_id: "user_viewer_watch",
      email: "viewer@example.com",
      role: "viewer",
      status: "active",
      recovery_hash: null,
      created_at: new Date().toISOString(),
      request_quota: 5,
      stream_quota: 2,
      remote_bitrate_kbps: 4000,
      allow_4k: 0,
    } satisfies UserRow;
    getDb()
      .prepare(
        `INSERT INTO users (id, clerk_user_id, email, role, status, recovery_hash, created_at)
         VALUES (?, ?, ?, 'viewer', 'active', NULL, ?)`,
      )
      .run(viewer.id, viewer.clerk_user_id, viewer.email, viewer.created_at);

    const created = await syncJellyfin({ user: viewer, baseUrl: base, apiKey: "jf-mock" });
    assert.equal(created.ok, true);
    assert.equal(created.externalId, "jf_user_1");
    assert.equal(creates, 1);

    const revoked = await syncJellyfin({
      user: { ...viewer, status: "revoked" },
      baseUrl: base,
      apiKey: "jf-mock",
    });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.externalId, "jf_user_1");
    assert.equal(creates, 1);
    assert.equal(policies.at(-1)?.body.IsDisabled, true);
    assert.match(policies.at(-1)?.url ?? "", /\/Users\/jf_user_1\/Policy$/);

    const restored = await syncJellyfin({ user: viewer, baseUrl: base, apiKey: "jf-mock" });
    assert.equal(restored.externalId, "jf_user_1");
    assert.equal(creates, 1);
    assert.equal(policies.at(-1)?.body.IsDisabled, false);
  });

  it("does not treat TMDB metadata as something the family can play", () => {
    const viewer = {
      id: "usr_catalog",
      clerk_user_id: "user_catalog",
      email: "catalog@example.com",
      role: "viewer" as const,
      status: "active" as const,
      recovery_hash: null,
      created_at: new Date().toISOString(),
      request_quota: 5,
      stream_quota: 2,
      remote_bitrate_kbps: 4000,
      allow_4k: 0,
    };
    const hit = {
      id: 693134,
      mediaType: "movie" as const,
      title: "Dune: Part Two",
      year: "2024",
      posterPath: null,
      overview: null,
    };
    const metadataOnly = buildCatalogCards([hit], viewer);
    assert.equal(metadataOnly[0]?.action, "request");
    assert.equal(metadataOnly[0]?.playable, false);

    const inHouse = buildCatalogCards([hit], viewer, {
      jellyfin: [{ title: "Dune: Part Two", year: "2024", playUrl: "https://media.example/play/1" }],
    });
    assert.equal(inHouse[0]?.action, "library");
    assert.equal(inHouse[0]?.playUrl, "https://media.example/play/1");

    const wrongYear = buildCatalogCards([hit], viewer, {
      jellyfin: [{ title: "Dune: Part Two", year: "2021", playUrl: "https://media.example/play/1" }],
    });
    assert.equal(wrongYear[0]?.action, "request");

    const key = identityKey(identityFromCatalog(hit));
    const ranked = buildCatalogCards([hit], viewer, { rankedKeys: new Set([key]) });
    assert.equal(ranked[0]?.action, "watch-now");
    assert.equal(ranked[0]?.playable, false);
    assert.equal(ranked[0]?.mediaId, null);
  });

  it("offers Watch Now from a tested indexer without starting playback or importing", async () => {
    getDb().prepare("UPDATE indexer_sources SET tested = 1 WHERE id = ?").run("eztv");
    const plan = await decideWatchNow({
      identity: identityFromCatalog({
        id: 693134,
        mediaType: "movie",
        title: "Dune: Part Two",
        year: "2024",
      }),
      role: "viewer",
      baseUrl: base,
      apiKey: "mock-key",
      savePaths: { qbit: "/mnt/downloads/qbit", watchNow: "/mnt/downloads/watch-now" },
    });
    assert.equal(plan.candidateAccepted, true);
    assert.equal(plan.started, false);
    assert.equal(plan.state, "failure");
    assert.equal(plan.message, FAMILY_COPY.failure);
    assert.notEqual(plan.watchNowSavePath, plan.librarySavePath);
    assert.match(plan.message, /didn't start/);
  });
});
