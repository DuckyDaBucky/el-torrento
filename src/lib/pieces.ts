/** Piece helpers. 416 is only for a range that misses the file, not for pieces still downloading. */

export function pieceCount(fileSize: number, pieceSize: number): number {
  if (fileSize <= 0 || pieceSize <= 0) return 0;
  return Math.ceil(fileSize / pieceSize);
}

export function piecesCovering(start: number, end: number, pieceSize: number, fileSize: number): number[] {
  if (pieceSize <= 0 || fileSize <= 0 || start >= fileSize || end < start || start < 0) return [];
  const last = Math.min(end, fileSize - 1);
  const first = Math.floor(start / pieceSize);
  const finalIndex = Math.floor(last / pieceSize);
  const pieces: number[] = [];
  for (let index = first; index <= finalIndex; index += 1) pieces.push(index);
  return pieces;
}

/** Position kept across a quality change. A live playhead wins; otherwise the stored position. */
export function keptPosition(currentTime: number, stored: number): number {
  if (Number.isFinite(currentTime) && currentTime > 0) return currentTime;
  if (Number.isFinite(stored) && stored > 0) return stored;
  return 0;
}

export function byteForTime(fileSize: number, durationSec: number, seconds: number): number {
  if (fileSize <= 0) return 0;
  if (durationSec <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, seconds / durationSec));
  return Math.min(fileSize - 1, Math.floor(ratio * fileSize));
}

export type RangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; status: 416 | 409; message: string };

/** Satisfiable means the range overlaps the full file. Missing pieces are not 416. */
export function resolveRange(input: {
  fileSize: number;
  header: string | null;
  generation: number;
  requestedGeneration: number;
}): RangeResult {
  if (input.requestedGeneration !== input.generation) {
    return {
      ok: false,
      status: 409,
      message: "This playback request is stale. Seek started a newer one.",
    };
  }
  if (input.fileSize <= 0) {
    return { ok: false, status: 416, message: "The file has no bytes." };
  }

  let start = 0;
  let end = input.fileSize - 1;
  if (input.header) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(input.header.trim());
    if (!match) {
      return { ok: false, status: 416, message: "Could not read that range." };
    }
    const startRaw = match[1];
    const endRaw = match[2];
    if (startRaw === "" && endRaw === "") {
      return { ok: false, status: 416, message: "Could not read that range." };
    }
    if (startRaw === "") {
      const suffix = Number(endRaw);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        return { ok: false, status: 416, message: "Could not read that range." };
      }
      start = Math.max(0, input.fileSize - suffix);
      end = input.fileSize - 1;
    } else {
      start = Number(startRaw);
      end = endRaw === "" ? input.fileSize - 1 : Number(endRaw);
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    return { ok: false, status: 416, message: "Could not read that range." };
  }
  if (start >= input.fileSize) {
    return { ok: false, status: 416, message: "That range is outside the file." };
  }
  end = Math.min(end, input.fileSize - 1);
  return { ok: true, start, end };
}
