import { assertOwner, audit, getDb, type UserRow } from "./db";

export type IndexerSource = {
  id: string;
  label: string;
  kind: "public" | "private";
  prowlarrDefinition: string | null;
  enabled: boolean;
  tested: boolean;
  notes: string | null;
};

function rowToSource(row: {
  id: string;
  label: string;
  kind: string;
  prowlarr_definition: string | null;
  enabled: number;
  tested: number;
  notes: string | null;
}): IndexerSource {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind === "private" ? "private" : "public",
    prowlarrDefinition: row.prowlarr_definition,
    enabled: row.enabled === 1,
    tested: row.tested === 1,
    notes: row.notes,
  };
}

export function listIndexerSources(): IndexerSource[] {
  const rows = getDb()
    .prepare("SELECT * FROM indexer_sources ORDER BY label")
    .all() as {
    id: string;
    label: string;
    kind: string;
    prowlarr_definition: string | null;
    enabled: number;
    tested: number;
    notes: string | null;
  }[];
  return rows.map(rowToSource);
}

export function setIndexerSource(
  actor: UserRow,
  id: string,
  patch: { enabled?: boolean; tested?: boolean },
): IndexerSource {
  assertOwner(actor);
  const current = getDb().prepare("SELECT * FROM indexer_sources WHERE id = ?").get(id) as
    | {
        id: string;
        label: string;
        kind: string;
        prowlarr_definition: string | null;
        enabled: number;
        tested: number;
        notes: string | null;
      }
    | undefined;
  if (!current) throw new Error("Unknown source.");
  if (current.kind === "private" && patch.enabled && !patch.tested && current.tested !== 1) {
    throw new Error("Private indexers stay off until access is tested and confirmed.");
  }
  if (patch.enabled && !patch.tested && current.tested !== 1) {
    throw new Error("Enable only after a real Prowlarr search succeeds (mark tested first).");
  }
  const enabled = patch.enabled ?? current.enabled === 1;
  const tested = patch.tested ?? current.tested === 1;
  if (enabled && !tested) {
    throw new Error("Cannot enable an untested source.");
  }
  getDb()
    .prepare("UPDATE indexer_sources SET enabled = ?, tested = ? WHERE id = ?")
    .run(enabled ? 1 : 0, tested ? 1 : 0, id);
  audit(actor.id, "indexer-source", id, "ok", enabled ? "enabled" : "disabled");
  return rowToSource(
    getDb().prepare("SELECT * FROM indexer_sources WHERE id = ?").get(id) as {
      id: string;
      label: string;
      kind: string;
      prowlarr_definition: string | null;
      enabled: number;
      tested: number;
      notes: string | null;
    },
  );
}

export type RemoteIndexer = {
  id: number;
  name: string;
  definitionName: string | null;
};

export type ProwlarrRelease = {
  title: string;
  indexerId: number;
  indexerName: string;
  size: number;
  seeders: number;
  protocol: string | null;
  files: { path: string }[];
};

function indexerMatches(source: IndexerSource, remote: RemoteIndexer): boolean {
  const def = (source.prowlarrDefinition ?? "").trim().toLowerCase();
  const label = source.label.trim().toLowerCase();
  const id = source.id.trim().toLowerCase();
  const name = remote.name.trim().toLowerCase();
  const definition = (remote.definitionName ?? "").trim().toLowerCase();
  if (def && (definition === def || name === def)) return true;
  return name === label || name === id;
}

/** Prowlarr indexers that correspond to a locally tested source. Untested sources never match. */
export function selectTestedIndexerIds(local: IndexerSource[], remote: RemoteIndexer[]): number[] {
  const tested = local.filter((item) => item.tested);
  const ids: number[] = [];
  for (const item of remote) {
    if (tested.some((source) => indexerMatches(source, item))) ids.push(item.id);
  }
  return ids;
}

export async function listProwlarrIndexers(input: {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; indexers: RemoteIndexer[]; error?: string }> {
  if (!input.baseUrl || !input.apiKey) return { ok: false, indexers: [], error: "Prowlarr is not configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/api/v1/indexer`, {
      headers: { "X-Api-Key": input.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, indexers: [], error: `Prowlarr HTTP ${res.status}` };
    const body = (await res.json()) as { id?: number; name?: string; definitionName?: string | null }[];
    const indexers = (Array.isArray(body) ? body : [])
      .filter((item) => item.id != null && item.name)
      .map((item) => ({
        id: item.id!,
        name: item.name!,
        definitionName: item.definitionName ?? null,
      }));
    return { ok: true, indexers };
  } catch (error) {
    return { ok: false, indexers: [], error: error instanceof Error ? error.message : "Prowlarr unreachable." };
  }
}

export async function searchProwlarr(input: {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  query: string;
  indexerIds: number[];
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; releases: ProwlarrRelease[]; error?: string }> {
  if (!input.indexerIds.length) return { ok: true, releases: [] };
  if (!input.baseUrl || !input.apiKey) return { ok: false, releases: [], error: "Prowlarr is not configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({ query: input.query, type: "search" });
  for (const id of input.indexerIds) params.append("indexerIds", String(id));
  try {
    const res = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/api/v1/search?${params}`, {
      headers: { "X-Api-Key": input.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, releases: [], error: `Prowlarr HTTP ${res.status}` };
    const body = (await res.json()) as {
      title?: string;
      indexerId?: number;
      indexer?: string;
      size?: number;
      seeders?: number;
      protocol?: string;
      files?: { path?: string; name?: string }[];
    }[];
    const releases: ProwlarrRelease[] = (Array.isArray(body) ? body : [])
      .filter((item) => item.title && item.indexerId != null)
      .map((item) => ({
        title: item.title!,
        indexerId: item.indexerId!,
        indexerName: item.indexer ?? "",
        size: item.size ?? 0,
        seeders: item.seeders ?? 0,
        protocol: item.protocol ?? null,
        files: (item.files ?? [])
          .map((file) => file.path || file.name || "")
          .filter(Boolean)
          .map((path) => ({ path })),
      }));
    return { ok: true, releases };
  } catch (error) {
    return { ok: false, releases: [], error: error instanceof Error ? error.message : "Prowlarr search failed." };
  }
}

export async function prowlarrStatus(input: {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; indexerCount?: number; error?: string }> {
  if (!input.baseUrl || !input.apiKey) return { ok: false, error: "Prowlarr is not configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/api/v1/indexer`, {
      headers: { "X-Api-Key": input.apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `Prowlarr HTTP ${res.status}` };
    const body = (await res.json()) as unknown[];
    return { ok: true, indexerCount: body.length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Prowlarr unreachable." };
  }
}
