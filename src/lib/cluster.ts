export type NodeId = "pve-5050" | "pve3040a" | "pve-3040b";

export type LiveNode = {
  id: NodeId;
  title: string;
  model: string;
  ip: string;
  online: "online" | "offline" | "unknown";
  uptime: string | null;
  cpu: string | null;
  ram: string | null;
  storage: string | null;
  thinPool: string | null;
  diskHealth: string | null;
  rxTx: string | null;
  guests: string | null;
  temperature: string | null;
  warnings: string[];
  checkedAt: string | null;
  reason: string | null;
};

export const NODE_ORDER: { id: NodeId; title: string; model: string; ip: string }[] = [
  { id: "pve-5050", title: "5050", model: "i5-7500", ip: "192.168.4.20" },
  { id: "pve3040a", title: "3040a", model: "i5-6500", ip: "192.168.4.109" },
  { id: "pve-3040b", title: "3040b", model: "i5-6500", ip: "192.168.4.33" },
];

/** Historical read-only check. Not a live feed. */
export const PREFLIGHT_SNAPSHOT = {
  collectedAt: "2026-09-26T09:30:00Z",
  source: "SSH read-only preflight",
  quorum: "quorate, 3 votes, quorum 2",
  nodes: [
    {
      id: "pve-5050" as const,
      ram: "5.0 GiB available of 7.6 GiB",
      root: "59G free of 68G",
      thinPool: "141.49 GiB, about 1.6 GiB used, data 1.14% / meta 1.16%",
    },
    {
      id: "pve3040a" as const,
      ram: "13 GiB available of 15 GiB",
      root: "32G free of 39G",
      thinPool: "53.93 GiB empty, data 0% / meta 1.59%",
    },
    {
      id: "pve-3040b" as const,
      ram: "13 GiB available of 15 GiB",
      root: "84G free of 94G",
      thinPool: "337.86 GiB empty, data 0% / meta 0.50%",
    },
  ],
};

function unknownNode(meta: (typeof NODE_ORDER)[number], reason: string | null): LiveNode {
  return {
    id: meta.id,
    title: meta.title,
    model: meta.model,
    ip: meta.ip,
    online: "unknown",
    uptime: null,
    cpu: null,
    ram: null,
    storage: null,
    thinPool: null,
    diskHealth: null,
    rxTx: null,
    guests: null,
    temperature: null,
    warnings: [],
    checkedAt: new Date().toISOString(),
    reason,
  };
}

type PveStatus = {
  uptime?: number;
  cpu?: number;
  memory?: { used?: number; total?: number };
  rootfs?: { used?: number; total?: number };
};

export async function collectLiveNodes(opts?: {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<{ nodes: LiveNode[]; quorum: string | null; error: string | null }> {
  const env = opts?.env ?? process.env;
  const base = env.PVE_URL;
  const tokenId = env.PVE_TOKEN_ID;
  const tokenSecret = env.PVE_TOKEN_SECRET;
  if (!base || !tokenId || !tokenSecret) {
    return {
      nodes: NODE_ORDER.map((meta) =>
        unknownNode(meta, "No read-only Proxmox token is configured."),
      ),
      quorum: null,
      error: "No read-only Proxmox token is configured.",
    };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const headers = { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` };
  try {
    const statusRes = await fetchImpl(`${base.replace(/\/$/, "")}/api2/json/cluster/status`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!statusRes.ok) {
      const reason = `Proxmox returned HTTP ${statusRes.status}.`;
      return {
        nodes: NODE_ORDER.map((meta) => unknownNode(meta, reason)),
        quorum: null,
        error: reason,
      };
    }
    const statusJson = (await statusRes.json()) as {
      data?: { type?: string; name?: string; quorate?: number; online?: number }[];
    };
    const cluster = statusJson.data?.find((row) => row.type === "cluster");
    const quorum = cluster
      ? cluster.quorate
        ? "quorate"
        : "not quorate"
      : null;

    const nodes: LiveNode[] = [];
    for (const meta of NODE_ORDER) {
      const nodeRes = await fetchImpl(
        `${base.replace(/\/$/, "")}/api2/json/nodes/${meta.id}/status`,
        { headers, signal: AbortSignal.timeout(4000) },
      );
      if (!nodeRes.ok) {
        nodes.push(unknownNode(meta, `Status HTTP ${nodeRes.status}.`));
        continue;
      }
      const body = (await nodeRes.json()) as { data?: PveStatus };
      const data = body.data ?? {};
      const cpu = typeof data.cpu === "number" ? `${Math.round(data.cpu * 100)}%` : null;
      const ram =
        data.memory?.used != null && data.memory.total
          ? `${Math.round(data.memory.used / 1024 / 1024)} / ${Math.round(data.memory.total / 1024 / 1024)} MiB`
          : null;
      nodes.push({
        ...unknownNode(meta, null),
        online: "online",
        uptime: data.uptime != null ? `${Math.floor(data.uptime / 3600)}h` : null,
        cpu,
        ram,
        reason: null,
        temperature: null,
        diskHealth: null,
      });
    }
    return { nodes, quorum, error: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Proxmox could not be reached.";
    return {
      nodes: NODE_ORDER.map((meta) => unknownNode(meta, reason)),
      quorum: null,
      error: reason,
    };
  }
}
