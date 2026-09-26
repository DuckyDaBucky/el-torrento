import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { engineRead, engineWait } from "./engine-client";
import { ensureHlsOnWorker, mediaWorkerBase } from "./media-worker-client";

type HlsSource = {
  id: string;
  file_size: number;
  duration_sec: number;
  height?: number;
};

const WINDOW_BYTES = 512 * 1024;

export type HlsReason = "software-4k" | "upscale" | "unverified";

export type HlsReady = {
  ready: boolean;
  playlist?: string;
  remote?: boolean;
  reason?: HlsReason;
};

export function heightFor(profile: string): number {
  if (profile === "2160p") return 2160;
  if (profile === "1080p") return 1080;
  if (profile === "720p") return 720;
  if (profile === "480p") return 480;
  return 0;
}

/** Software 4K encode is not enabled. A hardware path is not assumed here. */
export function software4kEnabled(): boolean {
  return false;
}

/** Fit inside the target height. Never scales a shorter picture up. */
export function downscaleFilter(height: number): string {
  return `scale=-2:'min(${height},ih)'`;
}

export function hlsDir(mediaId: string, generation: number, profile: string): string {
  return path.join(process.cwd(), "data", "hls", mediaId, String(generation), profile);
}

async function verifiedSlice(
  row: HlsSource,
  positionSec: number,
): Promise<{ start: number; end: number; body: Buffer } | null> {
  if (row.file_size <= 0) return null;
  const duration = row.duration_sec > 0 ? row.duration_sec : 1;
  const ratio = Math.min(0.98, Math.max(0, positionSec / duration));
  const start = Math.min(row.file_size - 1, Math.floor(ratio * row.file_size));
  const aligned = start - (start % 188);
  if (aligned < 0 || aligned >= row.file_size) return null;
  const end = Math.min(row.file_size - 1, aligned + WINDOW_BYTES - 1);
  try {
    const timeout = Number(process.env.PIECE_WAIT_MS ?? 8000);
    const waited = await engineWait(row.id, aligned, end, timeout);
    if (!waited.ready || waited.verifiedEnd < aligned) return null;
    const bytes = await engineRead(row.id, aligned, waited.verifiedEnd);
    if (bytes.body.length < 188 * 8) return null;
    return { start: aligned, end: bytes.verifiedEnd, body: bytes.body };
  } catch {
    return null;
  }
}

export async function ensureHls(input: {
  row: HlsSource;
  generation: number;
  profile: string;
  positionSec: number;
}): Promise<HlsReady> {
  if (input.profile === "2160p") {
    return { ready: false, reason: "software-4k" };
  }
  const height = heightFor(input.profile);
  if (!height) return { ready: false, reason: "unverified" };
  if ((input.row.height ?? 0) > 0 && height > (input.row.height ?? 0)) {
    return { ready: false, reason: "upscale" };
  }

  const slice = await verifiedSlice(input.row, input.positionSec);
  if (!slice) return { ready: false, reason: "unverified" };

  if (mediaWorkerBase()) {
    try {
      const remote = await ensureHlsOnWorker({
        torrentId: input.row.id,
        generation: input.generation,
        profile: input.profile,
        positionSec: input.positionSec,
        fileSize: input.row.file_size,
        durationSec: input.row.duration_sec,
        verifiedStart: slice.start,
        verifiedEnd: slice.end,
      });
      if (!remote.ready) return { ready: false, reason: "unverified" };
      return { ready: true, playlist: "remote", remote: true };
    } catch {
      return { ready: false, reason: "unverified" };
    }
  }

  const dir = hlsDir(input.row.id, input.generation, input.profile);
  await mkdir(dir, { recursive: true });
  const partial = path.join(dir, "partial.mpegts");
  await writeFile(partial, slice.body);
  const playlist = path.join(dir, "index.m3u8");
  await runFfmpeg(partial, dir, height);
  const info = await stat(playlist).catch(() => null);
  if (!info || info.size === 0) return { ready: false, reason: "unverified" };
  const text = await readFile(playlist, "utf8");
  if (!text.includes("#EXTINF")) return { ready: false, reason: "unverified" };
  return { ready: true, playlist };
}

function runFfmpeg(input: string, dir: string, height: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-vf",
        downscaleFilter(height),
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
        "-hls_flags",
        "independent_segments",
        "-hls_segment_filename",
        "seg_%03d.ts",
        "index.m3u8",
      ],
      { cwd: dir, stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}
