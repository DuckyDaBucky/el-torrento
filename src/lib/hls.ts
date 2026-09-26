import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { engineRead, engineWait } from "./engine-client";
import { ensureHlsOnWorker, mediaWorkerBase } from "./media-worker-client";

type HlsSource = {
  id: string;
  file_size: number;
  duration_sec: number;
};

const WINDOW_BYTES = 512 * 1024;

function heightFor(profile: string): number {
  if (profile === "2160p") return 2160;
  if (profile === "1080p") return 1080;
  if (profile === "720p") return 720;
  if (profile === "480p") return 480;
  return 0;
}

export function hlsDir(mediaId: string, generation: number, profile: string): string {
  return path.join(process.cwd(), "data", "hls", mediaId, String(generation), profile);
}

export async function ensureHls(input: {
  row: HlsSource;
  generation: number;
  profile: string;
  positionSec: number;
}): Promise<{ ready: boolean; playlist?: string; remote?: boolean }> {
  const height = heightFor(input.profile);
  if (!height) return { ready: false };

  if (mediaWorkerBase()) {
    const remote = await ensureHlsOnWorker({
      torrentId: input.row.id,
      generation: input.generation,
      profile: input.profile,
      positionSec: input.positionSec,
      fileSize: input.row.file_size,
      durationSec: input.row.duration_sec,
    });
    if (remote.ready) {
      return { ready: true, playlist: "remote", remote: true };
    }
    return { ready: false };
  }
  const duration = input.row.duration_sec > 0 ? input.row.duration_sec : 1;
  const ratio = Math.min(0.98, Math.max(0, input.positionSec / duration));
  const start = Math.min(input.row.file_size - 1, Math.floor(ratio * input.row.file_size));
  const aligned = start - (start % 188);
  const end = Math.min(input.row.file_size - 1, aligned + WINDOW_BYTES - 1);
  const timeout = Number(process.env.PIECE_WAIT_MS ?? 8000);
  const waited = await engineWait(input.row.id, aligned, end, timeout);
  if (!waited.ready || waited.verifiedEnd < aligned) return { ready: false };
  const bytes = await engineRead(input.row.id, aligned, waited.verifiedEnd);
  if (bytes.body.length < 188 * 8) return { ready: false };

  const dir = hlsDir(input.row.id, input.generation, input.profile);
  await mkdir(dir, { recursive: true });
  const partial = path.join(dir, "partial.mpegts");
  await writeFile(partial, bytes.body);
  const playlist = path.join(dir, "index.m3u8");
  await runFfmpeg(partial, dir, height);
  const info = await stat(playlist).catch(() => null);
  if (!info || info.size === 0) return { ready: false };
  const text = await readFile(playlist, "utf8");
  if (!text.includes("#EXTINF")) return { ready: false };
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
