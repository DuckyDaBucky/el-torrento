import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { GET as contentGet } from "../app/api/media/[id]/content/route";
import { GET as hlsGet } from "../app/api/media/[id]/hls/[generation]/[profile]/[file]/route";
import { POST as playbackPost } from "../app/api/media/[id]/playback/route";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import { bootstrapOwner, getDb, resetDbForTests } from "../src/lib/db";

function sessionRequest(sessionId: string, url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("cookie", `et_session=${encodeURIComponent(sessionId)}`);
  return new Request(url, { ...init, headers });
}

beforeEach(() => {
  process.env.ELTORRENTO_DB = ":memory:";
  process.env.ENGINE_URL = "http://127.0.0.1:9";
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.ELTORRENTO_DB;
  delete process.env.ENGINE_URL;
});

function seedTitle(): { sessionId: string; userId: string } {
  const owner = bootstrapOwner({
    clerkUserId: "user_owner_routes",
    email: BOOTSTRAP_OWNER_EMAIL,
    emailVerified: true,
  });
  assert.equal(owner.ok, true);
  if (!owner.ok) throw new Error("owner");
  getDb()
    .prepare(
      `INSERT INTO media (
        id, title, height, video_codec, audio_codec, hdr, delivery_confirmed,
        request_state, available_pieces, piece_count, piece_size, file_path, file_size, encoder_2160, duration_sec
      ) VALUES (?, ?, ?, 'H.264', 'TrueHD Atmos', 'Dolby Vision', 1, 'available', 0, 4, 16384, NULL, 100000, 0, 60)`,
    )
    .run("clip", "Route clip", 720);
  return { sessionId: owner.sessionId, userId: owner.user.id };
}

describe("playback routes", () => {
  it("keeps the playhead across seek and quality changes", async () => {
    const { sessionId } = seedTitle();
    const first = await playbackPost(
      sessionRequest(sessionId, "http://localhost/api/media/clip/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "720p", positionSeconds: 12.5 }),
      }),
      { params: Promise.resolve({ id: "clip" }) },
    );
    assert.equal(first.status, 200);
    const opened = (await first.json()) as { position: number; profile: string; generation: number };
    assert.equal(opened.position, 12.5);
    assert.equal(opened.profile, "720p");
    const second = await playbackPost(
      sessionRequest(sessionId, "http://localhost/api/media/clip/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "480p", positionSeconds: 40 }),
      }),
      { params: Promise.resolve({ id: "clip" }) },
    );
    assert.equal(second.status, 200);
    const sought = (await second.json()) as { position: number; profile: string; generation: number };
    assert.equal(sought.position, 40);
    assert.equal(sought.profile, "480p");
    assert.ok(sought.generation > opened.generation);
    const stored = getDb()
      .prepare("SELECT position_sec, profile FROM playback WHERE media_id = ?")
      .get("clip") as { position_sec: number; profile: string };
    assert.equal(stored.position_sec, 40);
    assert.equal(stored.profile, "480p");
  });

  it("refuses a 2160p request the source cannot supply", async () => {
    const { sessionId } = seedTitle();
    const res = await playbackPost(
      sessionRequest(sessionId, "http://localhost/api/media/clip/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "2160p", positionSeconds: 4 }),
      }),
      { params: Promise.resolve({ id: "clip" }) },
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /2160p/);
  });

  it("returns 416 only when the range misses the file", async () => {
    const { sessionId, userId } = seedTitle();
    getDb()
      .prepare("INSERT INTO playback (user_id, media_id, generation, position_sec, profile) VALUES (?, ?, 1, 3, 'original')")
      .run(userId, "clip");
    const outside = await contentGet(
      sessionRequest(sessionId, "http://localhost/api/media/clip/content?g=1&profile=original", {
        headers: { range: "bytes=100000-100100" },
      }),
      { params: Promise.resolve({ id: "clip" }) },
    );
    assert.equal(outside.status, 416);
    const outsideBody = (await outside.json()) as { error: string };
    assert.match(outsideBody.error, /outside the file/i);

    const inside = await contentGet(
      sessionRequest(sessionId, "http://localhost/api/media/clip/content?g=1&profile=original", {
        headers: { range: "bytes=0-2047" },
      }),
      { params: Promise.resolve({ id: "clip" }) },
    );
    assert.equal(inside.status, 503);
    assert.notEqual(inside.status, 416);
  });

  it("does not start a software 4K transcode or an upscale", async () => {
    const { sessionId, userId } = seedTitle();
    getDb()
      .prepare("INSERT INTO playback (user_id, media_id, generation, position_sec, profile) VALUES (?, ?, 2, 0, 'original')")
      .run(userId, "clip");
    const fourK = await hlsGet(
      sessionRequest(sessionId, "http://localhost/api/media/clip/hls/2/2160p/index.m3u8"),
      { params: Promise.resolve({ id: "clip", generation: "2", profile: "2160p", file: "index.m3u8" }) },
    );
    assert.equal(fourK.status, 409);
    const fourKBody = (await fourK.json()) as { error: string };
    assert.match(fourKBody.error, /software transcode is not enabled/i);

    const upscale = await hlsGet(
      sessionRequest(sessionId, "http://localhost/api/media/clip/hls/2/1080p/index.m3u8"),
      { params: Promise.resolve({ id: "clip", generation: "2", profile: "1080p", file: "index.m3u8" }) },
    );
    assert.equal(upscale.status, 409);
    const upscaleBody = (await upscale.json()) as { error: string };
    assert.match(upscaleBody.error, /upscale/i);
  });
});
