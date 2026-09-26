import express from "express";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 8080);
const ENGINE = (process.env.ENGINE_URL ?? "http://127.0.0.1:8741").replace(/\/$/, "");
const TOKEN = process.env.ENGINE_TOKEN ?? "";
const CACHE = process.env.HLS_CACHE ?? "/cache/hls";
const WAIT_MS = Number(process.env.PIECE_WAIT_MS ?? 8000);

function engineHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function engineWait(torrentId, start, end) {
  const res = await fetch(`${ENGINE}/v1/torrents/${encodeURIComponent(torrentId)}/wait`, {
    method: "POST",
    headers: { ...engineHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ start, end, timeoutMs: WAIT_MS }),
  });
  return res.json();
}

async function engineRead(torrentId, start, end) {
  const res = await fetch(`${ENGINE}/v1/torrents/${encodeURIComponent(torrentId)}/bytes?start=${start}&end=${end}`, {
    headers: engineHeaders(),
  });
  if (!res.ok) throw new Error(`engine read ${res.status}`);
  const verifiedEnd = Number(res.headers.get("X-Verified-End") ?? end);
  const body = Buffer.from(await res.arrayBuffer());
  return { body, verifiedEnd };
}

function heightFor(profile) {
  if (profile === "480p") return 480;
  if (profile === "720p") return 720;
  if (profile === "1080p") return 1080;
  if (profile === "2160p") return 2160;
  return 720;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/v1/hls/:torrentId/:generation/:profile", async (req, res) => {
  const { torrentId, generation, profile } = req.params;
  const positionSec = Number(req.body?.positionSec ?? 0);
  const fileSize = Number(req.body?.fileSize ?? 0);
  const durationSec = Number(req.body?.durationSec ?? 1);
  if (!fileSize) return res.status(400).json({ error: "fileSize required" });
  const ratio = Math.min(0.98, Math.max(0, positionSec / durationSec));
  const start = Math.min(fileSize - 1, Math.floor(ratio * fileSize));
  const aligned = start - (start % 188);
  const end = Math.min(fileSize - 1, aligned + 512 * 1024 - 1);
  const waited = await engineWait(torrentId, aligned, end);
  if (!waited.ready) {
    return res.status(503).json({ error: "Pieces still downloading", retry: true });
  }
  const read = await engineRead(torrentId, aligned, waited.verifiedEnd);
  const dir = path.join(CACHE, torrentId, String(generation), profile);
  await mkdir(dir, { recursive: true });
  const partial = path.join(dir, "partial.mpegts");
  await writeFile(partial, read.body);
  const height = heightFor(profile);
  await new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        partial,
        "-vf",
        `scale=-2:${height}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-f",
        "hls",
        "-hls_time",
        "2",
        "-hls_playlist_type",
        "event",
        "-hls_list_size",
        "0",
        "-hls_segment_filename",
        "seg_%03d.ts",
        "index.m3u8",
      ],
      { cwd: dir, stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  const playlist = await readFile(path.join(dir, "index.m3u8"), "utf8");
  return res.json({
    ready: true,
    playlistPath: `/v1/hls/${torrentId}/${generation}/${profile}/index.m3u8`,
    baseTimestamp: aligned,
  });
});

app.get("/v1/hls/:torrentId/:generation/:profile/:file", async (req, res) => {
  const { torrentId, generation, profile, file } = req.params;
  if (file.includes("..")) return res.status(404).end();
  const target = path.join(CACHE, torrentId, generation, profile, file);
  const body = await readFile(target).catch(() => null);
  if (!body) return res.status(404).end();
  const type = file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

app.listen(PORT, () => {
  console.log(`media-worker on ${PORT}`);
});
