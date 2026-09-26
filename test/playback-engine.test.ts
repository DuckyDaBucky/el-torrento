import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import { acceptInvite, bootstrapOwner, createInvite, getDb, resetDbForTests, setUserStatus } from "../src/lib/db";
import { enginePrioritize, engineStatus } from "../src/lib/engine-client";
import { ensureHls } from "../src/lib/hls";
import { addTorrent, getMedia, openPlayback, readMediaRange } from "../src/lib/media";

type Fixture = {
  torrentPath: string;
  fileSize: number;
  pieceCount: number;
  pieceSize: number;
  durationSec: number;
  peer: string;
  height: number;
  seedDir: string;
};

const enginePort = 18741;
const seedPort = 43921;
let seedProc: ChildProcess | null = null;
let engineProc: ChildProcess | null = null;
let root = "";
let fixture: Fixture;
let mediaId = "";

function waitForLine(child: ChildProcess, ready: (line: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (ready(line)) {
          child.stdout?.off("data", onData);
          resolve(line);
          return;
        }
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => reject(new Error(`process exited ${code} before ready`)));
  });
}

describe("libtorrent playback", { timeout: 180000 }, () => {
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "el-torrento-play-"));
    process.env.ELTORRENTO_DB = path.join(root, "app.sqlite");
    process.env.ENGINE_URL = `http://127.0.0.1:${enginePort}`;
    process.env.PIECE_WAIT_MS = "8000";
    resetDbForTests();

    const engine = spawn("python3", ["engine/server.py", "--port", String(enginePort)], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    engineProc = engine;
    await waitForLine(engine, (line) => line.includes("listening"));

    const seed = spawn(
      "python3",
      ["engine/seed_fixture.py", "--dir", path.join(root, "fixture"), "--port", String(seedPort), "--seconds", "4"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    seedProc = seed;
    const line = await waitForLine(seed, (row) => row.startsWith("{"));
    fixture = JSON.parse(line) as Fixture;

    const owner = bootstrapOwner({
      clerkUserId: "user_owner_play",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(owner.ok, true);
    if (!owner.ok) return;
    const priorities = Array.from({ length: fixture.pieceCount }, (_, index) => (index === 0 ? 7 : 0));
    const row = await addTorrent(owner.user, {
      id: "authorized-clip",
      title: "Authorized clip",
      torrentPath: fixture.torrentPath,
      savePath: path.join(root, "download"),
      peer: fixture.peer,
      height: fixture.height,
      durationSec: fixture.durationSec,
      priorities,
    });
    mediaId = row.id;
  });

  after(async () => {
    seedProc?.kill("SIGTERM");
    engineProc?.kill("SIGTERM");
    resetDbForTests();
    delete process.env.ENGINE_URL;
    delete process.env.PIECE_WAIT_MS;
    delete process.env.ELTORRENTO_DB;
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("plays verified bytes before the torrent is complete and does not 416 a later range", async () => {
    const owner = getDb().prepare("SELECT * FROM users WHERE role = 'owner'").get() as import("../src/lib/db").UserRow;
    const opened = openPlayback(owner, mediaId, "original", 0);
    assert.equal(opened.position, 0);
    const deadline = Date.now() + 10000;
    let status = await engineStatus(mediaId);
    while (Date.now() < deadline && !(status.have.includes(0) && !status.have.includes(status.pieceCount - 1))) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = await engineStatus(mediaId);
    }
    assert.ok(status.have.includes(0));
    assert.ok(status.have.length < status.pieceCount);

    const early = await readMediaRange({
      user: owner,
      id: mediaId,
      generation: opened.generation,
      profile: "original",
      rangeHeader: "bytes=0-2047",
    });
    assert.equal("message" in early, false);
    if ("message" in early) return;
    assert.equal(early.status, 206);
    assert.equal(early.body.length, 2048);
    const source = await readFile(path.join(fixture.seedDir, "clip.ts"));
    assert.ok(early.body.equals(source.subarray(0, 2048)));
    process.env.PIECE_WAIT_MS = "50";
    const later = await readMediaRange({
      user: owner,
      id: mediaId,
      generation: opened.generation,
      profile: "original",
      rangeHeader: `bytes=${fixture.fileSize - 1500}-${fixture.fileSize - 1}`,
    });
    assert.equal("message" in later, true);
    if (!("message" in later)) return;
    assert.equal(later.status, 503);
    assert.notEqual(later.status, 416);

    process.env.PIECE_WAIT_MS = "8000";
    const lastPiece = fixture.pieceCount - 1;
    await enginePrioritize(mediaId, [lastPiece], 7);
    const sought = await readMediaRange({
      user: owner,
      id: mediaId,
      generation: opened.generation,
      profile: "original",
      rangeHeader: `bytes=${fixture.fileSize - 1500}-${fixture.fileSize - 1}`,
    });
    assert.equal("message" in sought, false);
    if ("message" in sought) return;
    assert.ok(sought.body.length > 0);
    assert.ok(sought.body.equals(source.subarray(fixture.fileSize - 1500)));
  });

  it("keeps position when the quality changes and builds HLS from a partial file", async () => {
    const owner = getDb().prepare("SELECT * FROM users WHERE role = 'owner'").get() as import("../src/lib/db").UserRow;
    const changed = openPlayback(owner, mediaId, "480p", 1.25);
    assert.equal(changed.position, 1.25);
    const stored = getDb()
      .prepare("SELECT position_sec, profile FROM playback WHERE media_id = ?")
      .get(mediaId) as { position_sec: number; profile: string };
    assert.equal(stored.position_sec, 1.25);
    assert.equal(stored.profile, "480p");

    const row = getMedia(mediaId);
    assert.ok(row);
    const hls = await ensureHls({ row, generation: changed.generation, profile: "480p", positionSec: 0 });
    assert.equal(hls.ready, true);
    assert.ok(hls.playlist);
    const playlist = await readFile(hls.playlist!, "utf8");
    assert.match(playlist, /#EXTINF/);
    const partial = await readFile(path.join(path.dirname(hls.playlist!), "partial.mpegts"));
    assert.ok(partial.length < fixture.fileSize);
  });

  it("rejects playback after the account is revoked", async () => {
    const owner = getDb().prepare("SELECT * FROM users WHERE role = 'owner'").get() as import("../src/lib/db").UserRow;
    const invite = createInvite(owner, "viewer-play@example.com");
    const viewer = acceptInvite(
      { clerkUserId: "user_viewer_play", email: "viewer-play@example.com", emailVerified: true },
      invite.code,
    );
    assert.equal(viewer.ok, true);
    if (!viewer.ok) return;
    const opened = openPlayback(viewer.user, mediaId, "original", 0);
    setUserStatus(owner, viewer.user.id, "revoked");
    const revoked = getDb().prepare("SELECT * FROM users WHERE id = ?").get(viewer.user.id) as typeof viewer.user;
    const blocked = await readMediaRange({
      user: revoked,
      id: mediaId,
      generation: opened.generation,
      profile: "original",
      rangeHeader: "bytes=0-100",
    });
    assert.equal("message" in blocked, true);
    if (!("message" in blocked)) return;
    assert.equal(blocked.status, 403);
  });
});
