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
