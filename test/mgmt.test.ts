import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import { bootstrapOwner, resetDbForTests, type UserRow } from "../src/lib/db";
import { requestGuestAction } from "../src/lib/mgmt";

let tempDir: string | null = null;
let owner: UserRow;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "el-torrento-mgmt-"));
  process.env.ELTORRENTO_DB = path.join(tempDir, "app.sqlite");
  resetDbForTests();
  const created = bootstrapOwner({
    clerkUserId: "user_owner_mgmt",
    email: BOOTSTRAP_OWNER_EMAIL,
    emailVerified: true,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  owner = created.user;
});

afterEach(() => {
  resetDbForTests();
  delete process.env.ELTORRENTO_DB;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function ask(guest: string, action: string, workerUrl?: string, fetchImpl?: typeof fetch) {
  return requestGuestAction({
    actor: owner,
    guest,
    action,
    idempotencyKey: "idem-1",
    workerUrl,
    fetchImpl,
  });
}

describe("requestGuestAction", () => {
  it("refuses power for VM 100 and the apps VM", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    for (const guest of ["media-playback", "media-apps", "100", "102", "192.168.4.52"]) {
      const result = await ask(guest, "shutdown", "http://mgmt-worker:9090", fetchImpl);
      assert.equal(result.ok, false, guest);
      assert.equal(result.status, 403, guest);
    }
    assert.equal(called, false);
  });

  it("refuses power off even for an allowlisted guest", async () => {
    const result = await ask("media-ingest", "stop", "http://mgmt-worker:9090", async () => {
      throw new Error("worker must not be called");
    });
    assert.equal(result.status, 403);
    assert.match(result.message, /Power off/);
  });

  it("does not call the worker when it is not configured", async () => {
    const result = await ask("media-storage", "shutdown");
    assert.equal(result.status, 501);
    assert.match(result.message, /not configured/);
    assert.match(result.message, /library export/);
  });

  it("sends only start or shutdown for storage and ingest", async () => {
    const seen: { guest?: string; action?: string }[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(JSON.parse(String(init?.body)) as { guest?: string; action?: string });
      return new Response(JSON.stringify({ message: "Accepted.", taskId: "task-1" }), { status: 200 });
    };
    const start = await ask("media-ingest", "start", "http://mgmt-worker:9090/", fetchImpl);
    const shutdown = await ask("media-storage", "shutdown", "http://mgmt-worker:9090/", fetchImpl);
    assert.equal(start.ok, true);
    assert.equal(shutdown.ok, true);
    assert.deepEqual(
      seen.map((row) => `${row.guest}:${row.action}`),
      ["media-ingest:start", "media-storage:shutdown"],
    );
  });
});
