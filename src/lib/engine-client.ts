export type EngineStatus = {
  id: string;
  fileSize: number;
  pieceSize: number;
  pieceCount: number;
  have: number[];
  filePath: string;
  complete: boolean;
};

export type EngineWait = {
  ready: boolean;
  verifiedStart: number;
  verifiedEnd: number;
  fileSize: number;
};

function engineBase(): string {
  return (process.env.ENGINE_URL ?? "http://127.0.0.1:8741").replace(/\/$/, "");
}

function headers(): Record<string, string> {
  const token = process.env.ENGINE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${engineBase()}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
}

export async function engineAdd(input: {
  id: string;
  torrentPath: string;
  savePath: string;
  peer?: string;
  priorities?: number[];
}): Promise<EngineStatus> {
  const response = await request("/v1/torrents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Engine add failed (${response.status}).`);
  }
  return (await response.json()) as EngineStatus;
}

export async function engineStatus(id: string): Promise<EngineStatus> {
  const response = await request(`/v1/torrents/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Engine status failed (${response.status}).`);
  return (await response.json()) as EngineStatus;
}

export async function enginePrioritize(id: string, pieces: number[], level = 7): Promise<void> {
  const response = await request(`/v1/torrents/${encodeURIComponent(id)}/priority`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pieces, level }),
  });
  if (!response.ok) throw new Error(`Engine priority failed (${response.status}).`);
}

export async function engineWait(id: string, start: number, end: number, timeoutMs: number): Promise<EngineWait> {
  const response = await request(`/v1/torrents/${encodeURIComponent(id)}/wait`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end, timeoutMs }),
  });
  const body = (await response.json()) as EngineWait & { error?: string };
  if (response.status === 416) {
    const error = new Error(body.error ?? "Range is outside the file.") as Error & { status?: number };
    error.status = 416;
    throw error;
  }
  if (!response.ok) throw new Error(body.error ?? `Engine wait failed (${response.status}).`);
  return body;
}

export async function engineRead(id: string, start: number, end: number): Promise<{ body: Buffer; verifiedEnd: number }> {
  const response = await request(
    `/v1/torrents/${encodeURIComponent(id)}/bytes?start=${start}&end=${end}`,
  );
  if (response.status === 416) {
    const error = new Error("Range is outside the file.") as Error & { status?: number };
    error.status = 416;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Those pieces are not verified yet.") as Error & { status?: number };
    error.status = 409;
    throw error;
  }
  const verifiedEnd = Number(response.headers.get("X-Verified-End") ?? end);
  const body = Buffer.from(await response.arrayBuffer());
  return { body, verifiedEnd };
}
