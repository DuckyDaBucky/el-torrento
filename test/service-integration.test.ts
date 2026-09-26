import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import { bootstrapOwner, resetDbForTests } from "../src/lib/db";
import { createRequest, listRequests, saveSeerrRequest } from "../src/lib/media";
import { requestTitleInSeerr, syncJellyfin, syncSeerr } from "../src/lib/services";

describe("Jellyfin and Seerr contracts", () => {
  let server: Server;
  let base: string;
  const seen: { jellyfin?: unknown; seerrUser?: unknown; seerrRequest?: unknown } = {};

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "el-torrento-svc-"));
    process.env.ELTORRENTO_DB = path.join(dir, "app.sqlite");
    resetDbForTests();
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        if (req.method === "POST" && req.url === "/Users/New") {
          seen.jellyfin = body;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ Id: "jf_user_1", Name: body.Name }));
          return;
        }
        if (req.method === "POST" && req.url === "/api/v1/user") {
          seen.seerrUser = body;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: 7, email: body.email }));
          return;
        }
        if (req.method === "GET" && req.url?.startsWith("/api/v1/search")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ results: [{ id: 550, mediaType: "movie", title: "Authorized" }] }));
          return;
        }
        if (req.method === "POST" && req.url === "/api/v1/request") {
          seen.seerrRequest = body;
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: 42, media: { id: 9 } }));
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

  it("creates a Jellyfin user, a Seerr user, and a Seerr request for a title", async () => {
    const owner = bootstrapOwner({
      clerkUserId: "user_owner_svc",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(owner.ok, true);
    if (!owner.ok) return;

    const jellyfin = await syncJellyfin({ user: owner.user, baseUrl: base, apiKey: "jf-test" });
    assert.equal(jellyfin.ok, true);
    assert.equal(jellyfin.externalId, "jf_user_1");
    assert.equal((seen.jellyfin as { Name?: string }).Name, owner.user.id);

    const seerrUser = await syncSeerr({ user: owner.user, baseUrl: base, apiKey: "seerr-test" });
    assert.equal(seerrUser.ok, true);
    assert.equal(seerrUser.externalId, "7");
    assert.equal((seen.seerrUser as { email?: string }).email, owner.user.email);

    const created = createRequest(owner.user, "Authorized");
    const requested = await requestTitleInSeerr({ title: "Authorized", baseUrl: base, apiKey: "seerr-test" });
    assert.equal(requested.ok, true);
    assert.equal(requested.externalId, "42");
    assert.deepEqual(seen.seerrRequest, { mediaType: "movie", mediaId: 550 });
    saveSeerrRequest(created.id, requested.externalId ?? null, null);
    const rows = listRequests();
    assert.equal(rows[0]?.seerrRequestId, "42");
    assert.equal(rows[0]?.state, "resolving");
  });
});
