import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { downscaleFilter, ensureHls, software4kEnabled } from "../src/lib/hls";
import { ensureHlsOnWorker } from "../src/lib/media-worker-client";

describe("verified HLS", () => {
  it("does not enable software 4K or an upscale filter", () => {
    assert.equal(software4kEnabled(), false);
    assert.match(downscaleFilter(720), /min\(720,ih\)/);
    const source = readFile(path.join(process.cwd(), "src/lib/hls.ts"), "utf8");
    return source.then((text) => {
      assert.equal(text.includes("lavfi"), false);
      assert.equal(text.includes(".mp4"), false);
    });
  });

  it("refuses 2160p before any encode", async () => {
    const result = await ensureHls({
      row: { id: "clip", file_size: 1000, duration_sec: 10, height: 2160 },
      generation: 1,
      profile: "2160p",
      positionSec: 0,
    });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "software-4k");
  });

  it("refuses a rendition taller than the source", async () => {
    const result = await ensureHls({
      row: { id: "clip", file_size: 1000, duration_sec: 10, height: 720 },
      generation: 1,
      profile: "1080p",
      positionSec: 0,
    });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "upscale");
  });

  it("does not build a playlist when verified bytes are unavailable", async () => {
    process.env.ENGINE_URL = "http://127.0.0.1:9";
    delete process.env.MEDIA_WORKER_URL;
    const result = await ensureHls({
      row: { id: "missing-clip", file_size: 50_000, duration_sec: 10, height: 1080 },
      generation: 3,
      profile: "480p",
      positionSec: 0,
    });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "unverified");
    delete process.env.ENGINE_URL;
  });

  it("does not call the worker without a verified byte window", async () => {
    process.env.MEDIA_WORKER_URL = "http://127.0.0.1:9";
    const result = await ensureHlsOnWorker({
      torrentId: "clip",
      generation: 1,
      profile: "480p",
      positionSec: 0,
      fileSize: 1000,
      durationSec: 10,
      verifiedStart: 20,
      verifiedEnd: 10,
    });
    assert.equal(result.ready, false);
    delete process.env.MEDIA_WORKER_URL;
  });
});
