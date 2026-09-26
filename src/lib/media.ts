import { open, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { getDb, getUser, type UserRow, audit } from "./db";
import { assertProfileAllowed, deliveryBadge, offeredProfiles, type ProfileId, type SourceFacts } from "./quality";
import { pieceCount, resolveRange } from "./pieces";

const PIECE_SIZE = 64 * 1024;
const DEMO_ID = "signal-check";

export function demoPath(): string {
  return path.join(process.cwd(), "data", "media", "signal-check.mp4");
}

export function cachePath(profile: string): string {
  return path.join(process.cwd(), "data", "cache", `signal-check-${profile}.mp4`);
}

export async function ensureDemoFile(): Promise<{ fileSize: number; pieces: number }> {
  const file = demoPath();
  try {
    const info = await stat(file);
    if (info.size > 0) {
      rememberFile(info.size);
      return { fileSize: info.size, pieces: pieceCount(info.size, PIECE_SIZE) };
    }
  } catch {
    /* create below */
  }
  await mkdir(path.dirname(file), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=1280x720:rate=24",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        "8",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        file,
      ],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  const info = await stat(file);
  rememberFile(info.size);
  return { fileSize: info.size, pieces: pieceCount(info.size, PIECE_SIZE) };
}

function rememberFile(fileSize: number): void {
  const pieces = pieceCount(fileSize, PIECE_SIZE);
  const start = Math.max(1, Math.ceil(pieces * 0.25));
  getDb()
    .prepare(
      `INSERT INTO media (
        id, title, height, video_codec, audio_codec, hdr, delivery_confirmed,
        request_state, available_pieces, piece_count, piece_size, file_path, file_size, encoder_2160
      ) VALUES (?, ?, 720, 'H.264', 'AAC stereo', NULL, 1, 'available', ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET file_size = excluded.file_size, piece_count = excluded.piece_count, file_path = excluded.file_path`,
    )
    .run(DEMO_ID, "Signal check", start, pieces, PIECE_SIZE, demoPath(), fileSize);
}

export function advanceDemoPieces(): number {
  const row = getMedia(DEMO_ID);
  if (!row) return 0;
  const next = Math.min(row.piece_count, row.available_pieces + 1);
  getDb().prepare("UPDATE media SET available_pieces = ? WHERE id = ?").run(next, DEMO_ID);
  return next;
}

export type MediaRow = {
  id: string;
  title: string;
  height: number;
  video_codec: string;
  audio_codec: string;
  hdr: string | null;
  delivery_confirmed: number;
  request_state: string;
  available_pieces: number;
  piece_count: number;
  piece_size: number;
  file_path: string | null;
  file_size: number;
  encoder_2160: number;
};

export function getMedia(id: string): MediaRow | undefined {
  return getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
}

export function listMedia(): MediaRow[] {
  return getDb().prepare("SELECT * FROM media ORDER BY title").all() as MediaRow[];
}

export function sourceFacts(row: MediaRow, user: UserRow): SourceFacts {
  return {
    height: row.height,
    hdr: row.hdr,
    audio: row.audio_codec,
    deliveryConfirmed: row.delivery_confirmed === 1,
    encoder2160: row.encoder_2160 === 1,
    allow4k: user.allow_4k === 1 || user.role === "owner",
  };
}

export function manifestFor(user: UserRow, id: string) {
  const row = getMedia(id);
  if (!row) return null;
  const facts = sourceFacts(row, user);
  const playback = getDb()
    .prepare("SELECT generation, position_sec, profile FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, id) as { generation: number; position_sec: number; profile: string } | undefined;
  return {
    id: row.id,
    title: row.title,
    state: row.request_state,
    height: row.height,
    availablePieces: row.available_pieces,
    pieceCount: row.piece_count,
    profiles: offeredProfiles(facts),
    badge: deliveryBadge(facts, (playback?.profile as ProfileId) ?? "original"),
    generation: playback?.generation ?? 0,
    position: playback?.position_sec ?? 0,
    profile: playback?.profile ?? "original",
  };
}

export function openPlayback(user: UserRow, id: string, profile: ProfileId): { generation: number } {
  const row = mustPlayable(user, id, profile);
  const existing = getDb()
    .prepare("SELECT generation FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, id) as { generation: number } | undefined;
  const generation = (existing?.generation ?? 0) + 1;
  getDb()
    .prepare(
      `INSERT INTO playback (user_id, media_id, generation, position_sec, profile)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET generation = excluded.generation, profile = excluded.profile`,
    )
    .run(user.id, id, generation, profile);
  audit(user.id, "play", id, "ok", profile);
  return { generation };
}

export function seekPlayback(user: UserRow, id: string, seconds: number, profile: ProfileId): { generation: number } {
  mustPlayable(user, id, profile);
  const existing = getDb()
    .prepare("SELECT generation FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, id) as { generation: number } | undefined;
  if (!existing) throw new Error("Start playback before seeking.");
  const generation = existing.generation + 1;
  getDb()
    .prepare(
      "UPDATE playback SET generation = ?, position_sec = ?, profile = ? WHERE user_id = ? AND media_id = ?",
    )
    .run(generation, seconds, profile, user.id, id);
  audit(user.id, "seek", id, "ok", `g=${generation}`);
  return { generation };
}

function mustPlayable(user: UserRow, id: string, profile: ProfileId): MediaRow {
  if (user.status !== "active") throw new Error("Playback is not allowed for this account.");
  const row = getMedia(id);
  if (!row || row.request_state !== "available") throw new Error("That title is not available.");
  const active = getDb()
    .prepare("SELECT COUNT(*) AS n FROM playback WHERE user_id = ?")
    .get(user.id) as { n: number };
  const already = getDb()
    .prepare("SELECT 1 FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, id);
  if (!already && active.n >= user.stream_quota && user.role !== "owner") {
    throw new Error("Stream quota is full.");
  }
  assertProfileAllowed(sourceFacts(row, user), profile === "auto" ? "original" : profile);
  return row;
}

export async function readMediaRange(input: {
  user: UserRow;
  id: string;
  generation: number;
  profile: ProfileId;
  rangeHeader: string | null;
}): Promise<
  | { status: 206 | 200; body: Buffer; start: number; end: number; totalAvailable: number; contentType: string }
  | { status: 401 | 403 | 404 | 409 | 416; message: string }
> {
  if (input.user.status !== "active") {
    return { status: 403, message: "Playback is not allowed for this account." };
  }
  const row = getMedia(input.id);
  if (!row?.file_path) return { status: 404, message: "No file for that title." };
  const playback = getDb()
    .prepare("SELECT generation, profile FROM playback WHERE user_id = ? AND media_id = ?")
    .get(input.user.id, input.id) as { generation: number; profile: string } | undefined;
  if (!playback) return { status: 403, message: "No playback session." };

  const profile = input.profile === "auto" ? "original" : input.profile;
  try {
    assertProfileAllowed(sourceFacts(row, input.user), profile);
  } catch (error) {
    return { status: 403, message: error instanceof Error ? error.message : "Profile refused." };
  }

  const file = profile === "original" ? row.file_path : await ensureTranscode(profile);
  const info = await stat(file);
  const pieceSize = profile === "original" ? row.piece_size : info.size;
  const availablePieces = profile === "original" ? row.available_pieces : 1;
  const resolved = resolveRange({
    fileSize: profile === "original" ? row.file_size || info.size : info.size,
    pieceSize,
    availablePieces,
    header: input.rangeHeader,
    generation: playback.generation,
    requestedGeneration: input.generation,
  });
  if (!resolved.ok) return { status: resolved.status, message: resolved.message };
  const length = resolved.end - resolved.start + 1;
  const handle = await open(file, "r");
  try {
    const body = Buffer.alloc(length);
    await handle.read(body, 0, length, resolved.start);
    const available =
      profile === "original"
        ? Math.min(row.file_size || info.size, row.available_pieces * row.piece_size)
        : info.size;
    return {
      status: input.rangeHeader ? 206 : 200,
      body,
      start: resolved.start,
      end: resolved.end,
      totalAvailable: available,
      contentType: "video/mp4",
    };
  } finally {
    await handle.close();
  }
}

async function ensureTranscode(profile: string): Promise<string> {
  const target = cachePath(profile);
  try {
    const info = await stat(target);
    if (info.size > 0) return target;
  } catch {
    /* encode */
  }
  const height = profile === "480p" ? 480 : profile === "720p" ? 720 : profile === "1080p" ? 1080 : 0;
  if (!height) throw new Error("That transcode is not available.");
  await mkdirp(path.dirname(target));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        demoPath(),
        "-vf",
        `scale=-2:${height}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        target,
      ],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  return target;
}

async function mkdirp(dir: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}

export function createRequest(user: UserRow, title: string): { id: string } {
  if (user.status !== "active") throw new Error("Account cannot request titles.");
  const count = getDb()
    .prepare("SELECT COUNT(*) AS n FROM media_requests WHERE user_id = ? AND state NOT IN ('available', 'failed')")
    .get(user.id) as { n: number };
  if (user.role !== "owner" && count.n >= user.request_quota) {
    throw new Error("Request quota is full.");
  }
  const id = `req_${randomBytes(8).toString("hex")}`;
  getDb()
    .prepare("INSERT INTO media_requests (id, user_id, title, state, created_at) VALUES (?, ?, ?, 'requested', ?)")
    .run(id, user.id, title.trim(), new Date().toISOString());
  return { id };
}

export function listRequests() {
  return getDb()
    .prepare(
      `SELECT r.id, r.title, r.state, r.created_at as createdAt, u.email
       FROM media_requests r JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`,
    )
    .all() as { id: string; title: string; state: string; createdAt: string; email: string }[];
}

const REQUEST_STATES = new Set(["requested", "resolving", "downloading", "importing", "available", "failed"]);

export function setRequestState(actor: UserRow, id: string, state: string): void {
  if (actor.role !== "owner") throw new Error("Owner access is required.");
  if (!REQUEST_STATES.has(state)) throw new Error("Unknown request state.");
  const current = getDb().prepare("SELECT id FROM media_requests WHERE id = ?").get(id);
  if (!current) throw new Error("Request not found.");
  getDb().prepare("UPDATE media_requests SET state = ? WHERE id = ?").run(state, id);
  audit(actor.id, "request-state", id, "ok", state);
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export { DEMO_ID };
