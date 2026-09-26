import { getDb, type UserRow, audit } from "./db";
import { assertProfileAllowed, deliveryBadge, offeredProfiles, type ProfileId, type SourceFacts } from "./quality";
import { byteForTime, piecesCovering, resolveRange } from "./pieces";
import { engineAdd, enginePrioritize, engineRead, engineStatus, engineWait } from "./engine-client";
import { randomBytes } from "node:crypto";

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
  duration_sec: number;
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

export async function refreshFromEngine(id: string): Promise<void> {
  const row = getMedia(id);
  if (!row) return;
  try {
    const status = await engineStatus(id);
    getDb()
      .prepare(
        `UPDATE media SET available_pieces = ?, piece_count = ?, piece_size = ?, file_size = ?, file_path = ? WHERE id = ?`,
      )
      .run(status.have.length, status.pieceCount, status.pieceSize, status.fileSize, status.filePath, id);
  } catch {
    /* Engine down: keep the last snapshot. */
  }
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
    sourceFacts: facts,
    badge: deliveryBadge(facts, (playback?.profile as ProfileId) ?? "original"),
    generation: playback?.generation ?? 0,
    position: playback?.position_sec ?? 0,
    profile: playback?.profile ?? "original",
    durationSec: row.duration_sec,
  };
}

export type ChangePlaybackResult = {
  generation: number;
  position: number;
  profile: ProfileId;
  streamUrl: string;
  baseTimestamp: number;
};

function resolvedProfile(profile: ProfileId): ProfileId {
  return profile === "auto" ? "original" : profile;
}

function buildStreamUrl(mediaId: string, generation: number, profile: ProfileId): string {
  const playProfile = resolvedProfile(profile);
  if (playProfile === "original") {
    return `/api/media/${mediaId}/content?g=${generation}&profile=original`;
  }
  return `/api/media/${mediaId}/hls/${generation}/${playProfile}/index.m3u8`;
}

/** Single entry for seek and quality changes. */
export async function changePlayback(
  user: UserRow,
  mediaId: string,
  absolutePosition: number,
  requestedQuality: ProfileId,
): Promise<ChangePlaybackResult> {
  const row = mustPlayable(user, mediaId, requestedQuality);
  const position = Math.max(0, absolutePosition);
  const profile = requestedQuality;
  const existing = getDb()
    .prepare("SELECT generation FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, mediaId) as { generation: number } | undefined;
  const generation = (existing?.generation ?? 0) + 1;
  getDb()
    .prepare(
      `INSERT INTO playback (user_id, media_id, generation, position_sec, profile)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET
         generation = excluded.generation,
         profile = excluded.profile,
         position_sec = excluded.position_sec`,
    )
    .run(user.id, mediaId, generation, position, resolvedProfile(profile));
  const byte = byteForTime(row.file_size, row.duration_sec, position);
  const pieces = piecesCovering(
    byte,
    Math.min(row.file_size - 1, byte + row.piece_size * 8),
    row.piece_size,
    row.file_size,
  );
  if (pieces.length) await enginePrioritize(mediaId, pieces, 7).catch(() => undefined);
  audit(user.id, "change-playback", mediaId, "ok", `${profile}@${position}`);
  return {
    generation,
    position,
    profile,
    streamUrl: buildStreamUrl(mediaId, generation, profile),
    baseTimestamp: byte,
  };
}

export async function openPlayback(
  user: UserRow,
  id: string,
  profile: ProfileId,
  positionSec = 0,
): Promise<ChangePlaybackResult> {
  return changePlayback(user, id, positionSec, profile);
}

export async function seekPlayback(
  user: UserRow,
  id: string,
  seconds: number,
  profile: ProfileId,
): Promise<ChangePlaybackResult> {
  const existing = getDb()
    .prepare("SELECT generation FROM playback WHERE user_id = ? AND media_id = ?")
    .get(user.id, id) as { generation: number } | undefined;
  if (!existing) throw new Error("Start playback before seeking.");
  return changePlayback(user, id, seconds, profile);
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

function waitMs(): number {
  return Number(process.env.PIECE_WAIT_MS ?? 8000);
}

export async function readMediaRange(input: {
  user: UserRow;
  id: string;
  generation: number;
  profile: ProfileId;
  rangeHeader: string | null;
}): Promise<
  | { status: 206 | 200; body: Buffer; start: number; end: number; fileSize: number; contentType: string }
  | { status: 401 | 403 | 404 | 409 | 416 | 503; message: string }
> {
  if (input.user.status !== "active") {
    return { status: 403, message: "Playback is not allowed for this account." };
  }
  const row = getMedia(input.id);
  if (!row) return { status: 404, message: "No file for that title." };
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
  if (profile !== "original") {
    return { status: 409, message: "That quality is served as HLS, not a finished MP4." };
  }

  const resolved = resolveRange({
    fileSize: row.file_size,
    header: input.rangeHeader,
    generation: playback.generation,
    requestedGeneration: input.generation,
  });
  if (!resolved.ok) return { status: resolved.status, message: resolved.message };

  let waited;
  try {
    waited = await engineWait(input.id, resolved.start, resolved.end, waitMs());
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 416) return { status: 416, message: "That range is outside the file." };
    return { status: 503, message: "The torrent engine did not answer." };
  }
  if (!waited.ready || waited.verifiedEnd < resolved.start) {
    return {
      status: 503,
      message: "Pieces for that position are still downloading. Playback stays open.",
    };
  }
  try {
    const read = await engineRead(input.id, resolved.start, waited.verifiedEnd);
    const full = !input.rangeHeader && read.body.length === row.file_size;
    return {
      status: full ? 200 : 206,
      body: read.body,
      start: resolved.start,
      end: read.verifiedEnd,
      fileSize: row.file_size,
      contentType: "video/mp2t",
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 416) return { status: 416, message: "That range is outside the file." };
    return { status: 503, message: "Verified bytes were not ready to read." };
  }
}

export async function addTorrent(
  user: UserRow,
  input: {
    id?: string;
    title: string;
    torrentPath: string;
    savePath: string;
    peer?: string;
    height?: number;
    durationSec?: number;
    priorities?: number[];
    encoder2160?: boolean;
  },
): Promise<MediaRow> {
  if (user.role !== "owner") throw new Error("Owner access is required.");
  const id = input.id ?? `med_${randomBytes(8).toString("hex")}`;
  const status = await engineAdd({
    id,
    torrentPath: input.torrentPath,
    savePath: input.savePath,
    peer: input.peer,
    priorities: input.priorities,
  });
  getDb()
    .prepare(
      `INSERT INTO media (
        id, title, height, video_codec, audio_codec, hdr, delivery_confirmed,
        request_state, available_pieces, piece_count, piece_size, file_path, file_size, encoder_2160, duration_sec
      ) VALUES (?, ?, ?, 'H.264', 'AAC stereo', NULL, 0, 'available', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_size = excluded.file_size,
        piece_count = excluded.piece_count,
        piece_size = excluded.piece_size,
        available_pieces = excluded.available_pieces,
        file_path = excluded.file_path,
        duration_sec = excluded.duration_sec`,
    )
    .run(
      id,
      input.title.trim(),
      input.height ?? 720,
      status.have.length,
      status.pieceCount,
      status.pieceSize,
      status.filePath,
      status.fileSize,
      input.encoder2160 ? 1 : 0,
      input.durationSec ?? 0,
    );
  audit(user.id, "add-torrent", id, "ok", input.title);
  const row = getMedia(id);
  if (!row) throw new Error("Torrent was added but not stored.");
  return row;
}

export function findRequestByTmdb(
  userId: string,
  tmdbId: string,
  mediaType: string,
): { id: string; state: string; seerrRequestId: string | null } | undefined {
  return getDb()
    .prepare(
      `SELECT id, state, seerr_request_id as seerrRequestId
       FROM media_requests
       WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(userId, tmdbId, mediaType) as
    | { id: string; state: string; seerrRequestId: string | null }
    | undefined;
}

export function createRequest(
  user: UserRow,
  title: string,
  meta?: { tmdbId?: string; mediaType?: string },
): { id: string } {
  if (user.status !== "active") throw new Error("Account cannot request titles.");
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Enter a title.");
  const count = getDb()
    .prepare("SELECT COUNT(*) AS n FROM media_requests WHERE user_id = ? AND state NOT IN ('available', 'failed')")
    .get(user.id) as { n: number };
  if (user.role !== "owner" && count.n >= user.request_quota) {
    throw new Error("Request quota is full.");
  }
  const id = `req_${randomBytes(8).toString("hex")}`;
  getDb()
    .prepare(
      `INSERT INTO media_requests (id, user_id, title, state, created_at, seerr_request_id, tmdb_id, media_type)
       VALUES (?, ?, ?, 'requested', ?, NULL, ?, ?)`,
    )
    .run(id, user.id, trimmed, new Date().toISOString(), meta?.tmdbId ?? null, meta?.mediaType ?? null);
  return { id };
}

export function saveSeerrRequest(id: string, externalId: string | null, error: string | null): void {
  getDb()
    .prepare("UPDATE media_requests SET seerr_request_id = ?, state = ? WHERE id = ?")
    .run(externalId, externalId ? "resolving" : "requested", id);
  if (error) {
    getDb().prepare("UPDATE media_requests SET state = 'requested' WHERE id = ? AND seerr_request_id IS NULL").run(id);
  }
}

export function listRequests() {
  return getDb()
    .prepare(
      `SELECT r.id, r.title, r.state, r.created_at as createdAt, r.seerr_request_id as seerrRequestId,
              r.tmdb_id as tmdbId, r.media_type as mediaType, u.email
       FROM media_requests r JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`,
    )
    .all() as {
    id: string;
    title: string;
    state: string;
    createdAt: string;
    seerrRequestId: string | null;
    tmdbId: string | null;
    mediaType: string | null;
    email: string;
  }[];
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
