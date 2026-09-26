/** Prefix piece map: pieces 0..available-1 are verified. Later pieces are holes. */

export function pieceCount(fileSize: number, pieceSize: number): number {
  if (fileSize <= 0 || pieceSize <= 0) return 0;
  return Math.ceil(fileSize / pieceSize);
}

export function availableByteLength(fileSize: number, pieceSize: number, availablePieces: number): number {
  if (availablePieces <= 0 || fileSize <= 0) return 0;
  const total = pieceCount(fileSize, pieceSize);
  const have = Math.min(availablePieces, total);
  return Math.min(fileSize, have * pieceSize);
}

export type RangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; status: 416 | 409; message: string };

export function resolveRange(input: {
  fileSize: number;
  pieceSize: number;
  availablePieces: number;
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
  const available = availableByteLength(input.fileSize, input.pieceSize, input.availablePieces);
  if (available <= 0) {
    return { ok: false, status: 416, message: "No verified pieces yet." };
  }

  let start = 0;
  let end = available - 1;
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
      start = Math.max(0, available - suffix);
      end = available - 1;
    } else {
      start = Number(startRaw);
      end = endRaw === "" ? available - 1 : Number(endRaw);
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    return { ok: false, status: 416, message: "Could not read that range." };
  }
  if (start >= available) {
    return {
      ok: false,
      status: 416,
      message: "That position is not downloaded yet. Playback cannot skip past missing pieces.",
    };
  }
  end = Math.min(end, available - 1);
  return { ok: true, start, end };
}
