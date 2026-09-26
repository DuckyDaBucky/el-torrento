type EnsureInput = {
  torrentId: string;
  generation: number;
  profile: string;
  positionSec: number;
  fileSize: number;
  durationSec: number;
  verifiedStart: number;
  verifiedEnd: number;
};

export function mediaWorkerBase(): string | undefined {
  return process.env.MEDIA_WORKER_URL?.replace(/\/$/, "") || undefined;
}

function verifiedWindow(input: EnsureInput): boolean {
  return (
    Number.isFinite(input.verifiedStart) &&
    Number.isFinite(input.verifiedEnd) &&
    input.verifiedStart >= 0 &&
    input.verifiedEnd >= input.verifiedStart
  );
}

/** Asks the worker to package a window the engine already hash-checked. */
export async function ensureHlsOnWorker(input: EnsureInput): Promise<{ ready: boolean; baseTimestamp?: number }> {
  const base = mediaWorkerBase();
  if (!base) return { ready: false };
  if (!verifiedWindow(input)) return { ready: false };
  const res = await fetch(
    `${base}/v1/hls/${encodeURIComponent(input.torrentId)}/${input.generation}/${encodeURIComponent(input.profile)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionSec: input.positionSec,
        fileSize: input.fileSize,
        durationSec: input.durationSec,
        verifiedStart: input.verifiedStart,
        verifiedEnd: input.verifiedEnd,
        verifiedBytesOnly: true,
      }),
      signal: AbortSignal.timeout(Number(process.env.MEDIA_WORKER_TIMEOUT_MS ?? 120000)),
    },
  );
  if (res.status === 503) return { ready: false };
  if (!res.ok) throw new Error(`media-worker ${res.status}`);
  const body = (await res.json()) as { ready?: boolean; baseTimestamp?: number };
  return { ready: Boolean(body.ready), baseTimestamp: body.baseTimestamp };
}

export async function readHlsFromWorker(input: {
  torrentId: string;
  generation: number;
  profile: string;
  file: string;
}): Promise<Buffer | null> {
  const base = mediaWorkerBase();
  if (!base) return null;
  const res = await fetch(
    `${base}/v1/hls/${encodeURIComponent(input.torrentId)}/${input.generation}/${encodeURIComponent(input.profile)}/${encodeURIComponent(input.file)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
