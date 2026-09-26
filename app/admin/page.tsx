"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LiveNode } from "@/src/lib/cluster";

type Section = "cluster" | "users" | "media" | "services" | "mcp";

type ClusterPayload = {
  live: { nodes: LiveNode[]; quorum: string | null; error: string | null };
  preflight: {
    collectedAt: string;
    source: string;
    quorum: string;
    nodes: { id: string; ram: string; root: string; thinPool: string }[];
  };
  audit: { action: string; target: string; result: string; createdAt: string }[];
};

type PublicUser = {
  id: string;
  email: string;
  role: string;
  status: string;
  requestQuota: number;
  streamQuota: number;
  remoteBitrateKbps: number;
  allow4k: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path, { credentials: "include", ...init });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

function asciiBox(title: string, lines: string[]): string {
  const inner = Math.max(title.length, ...lines.map((line) => line.length), 8);
  const bar = "+-" + "-".repeat(inner) + "-+";
  const row = (text: string) => "| " + text.padEnd(inner) + " |";
  return [bar, row(title), ...lines.map(row), bar].join("\n");
}

function formatMetric(value: string | null, fallback = "unknown"): string {
  return value && value.trim() ? value : fallback;
}

function isStale(checkedAt: string | null, maxAgeMs = 5 * 60 * 1000): boolean {
  if (!checkedAt) return true;
  const age = Date.now() - Date.parse(checkedAt);
  return !Number.isFinite(age) || age > maxAgeMs;
}

function nodePanel(node: LiveNode, preflight?: { ram: string; root: string; thinPool: string }): string {
  const online =
    node.online === "online" ? "ONLINE" : node.online === "offline" ? "OFFLINE" : "UNKNOWN";
  const stale = node.online !== "online" || isStale(node.checkedAt);
  const lines = [
    `${node.model} · ${node.ip}`,
    `state: ${online}${stale ? " (stale/unknown)" : ""}`,
    `uptime: ${formatMetric(node.uptime)}`,
    `cpu: ${formatMetric(node.cpu)}`,
    `ram: ${formatMetric(node.ram, preflight?.ram ?? "unknown")}`,
    `disk: ${formatMetric(node.storage, preflight?.root ?? "unknown")}`,
    `thin: ${formatMetric(node.thinPool, preflight?.thinPool ?? "unknown")}`,
  ];
  if (node.reason) lines.push(`note: ${node.reason}`);
  if (node.checkedAt) lines.push(`checked: ${node.checkedAt}`);
  return asciiBox(node.title.toUpperCase(), lines);
}

function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const items: { id: Section; label: string }[] = [
    { id: "cluster", label: "Cluster" },
    { id: "users", label: "Users" },
    { id: "media", label: "Media" },
    { id: "services", label: "Services" },
    { id: "mcp", label: "MCP" },
  ];
  return (
    <nav className="flex flex-wrap gap-2 font-mono text-xs uppercase tracking-widest">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={
            active === item.id
              ? "border border-[var(--phosphor)] px-3 py-1 text-[var(--phosphor)]"
              : "border border-[var(--term-line)] px-3 py-1 text-[var(--phosphor)]/60 hover:text-[var(--phosphor)]"
          }
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export default function AdminPage() {
  const [section, setSection] = useState<Section>("cluster");
  const [gate, setGate] = useState<"loading" | "denied" | "owner">("loading");
  const [cluster, setCluster] = useState<ClusterPayload | null>(null);
  const [clusterError, setClusterError] = useState("");
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [mediaRows, setMediaRows] = useState<
    { id: string; title: string; request_state: string; available_pieces: number; piece_count: number }[]
  >([]);
  const [requests, setRequests] = useState<{ id: string; title: string; state: string; email: string }[]>([]);
  const [guests, setGuests] = useState<{ id: string; vmid: number; note: string }[]>([]);
  const [workerConfigured, setWorkerConfigured] = useState(false);
  const [deployPlans, setDeployPlans] = useState<
    { id: string; digest: string; status: string; createdAt: string; body: { name: string; targetGuest: string } }[]
  >([]);
  const [agentConfigured, setAgentConfigured] = useState(false);
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const preflightById = useMemo(() => {
    const map = new Map<string, { ram: string; root: string; thinPool: string }>();
    cluster?.preflight.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [cluster]);

  const loadAuth = useCallback(async () => {
    const { ok, data } = await api<{ user: { role: string } | null }>("/api/auth");
    if (!ok || !data.user) {
      setGate("denied");
      return;
    }
    if (data.user.role !== "owner") {
      setGate("denied");
      return;
    }
    setGate("owner");
  }, []);

  const loadCluster = useCallback(async () => {
    setClusterError("");
    const { ok, status, data } = await api<ClusterPayload & { error?: string }>("/api/admin/cluster");
    if (!ok) {
      setClusterError(data.error ?? `Cluster API returned ${status}.`);
      return;
    }
    setCluster(data);
  }, []);

  const loadUsers = useCallback(async () => {
    const { ok, data } = await api<{ users: PublicUser[] }>("/api/admin/users");
    if (ok) setUsers(data.users ?? []);
  }, []);

  const loadMedia = useCallback(async () => {
    const { ok, data } = await api<{
      media: typeof mediaRows;
      requests: typeof requests;
    }>("/api/admin/media");
    if (ok) {
      setMediaRows(data.media ?? []);
      setRequests(data.requests ?? []);
    }
  }, []);

  const loadServices = useCallback(async () => {
    const guestsRes = await api<{ guests: typeof guests; workerConfigured: boolean }>("/api/admin/guests");
    if (guestsRes.ok) {
      setGuests(guestsRes.data.guests ?? []);
      setWorkerConfigured(Boolean(guestsRes.data.workerConfigured));
    }
    const deployRes = await api<{ plans: typeof deployPlans; agentConfigured: boolean }>("/api/admin/deploy");
    if (deployRes.ok) {
      setDeployPlans(deployRes.data.plans ?? []);
      setAgentConfigured(Boolean(deployRes.data.agentConfigured));
    }
  }, []);

  const loadMcp = useCallback(async () => {
    const { ok, data } = await api<{ tools: string[]; note?: string }>("/api/mcp");
    if (ok) setMcpTools(data.tools ?? []);
  }, []);

  useEffect(() => {
    loadAuth().catch(() => setGate("denied"));
  }, [loadAuth]);

  useEffect(() => {
    if (gate !== "owner") return;
    if (section === "cluster") loadCluster().catch(() => setClusterError("Could not load cluster."));
    if (section === "users") loadUsers().catch(() => undefined);
    if (section === "media") loadMedia().catch(() => undefined);
    if (section === "services") loadServices().catch(() => undefined);
    if (section === "mcp") loadMcp().catch(() => undefined);
  }, [gate, section, loadCluster, loadUsers, loadMedia, loadServices, loadMcp]);

  useEffect(() => {
    if (gate !== "owner" || section !== "cluster") return;
    const timer = setInterval(() => loadCluster().catch(() => undefined), 15000);
    return () => clearInterval(timer);
  }, [gate, section, loadCluster]);

  if (gate === "loading") {
    return (
      <Shell tone="admin">
        <p className="font-mono text-sm text-[var(--phosphor)]/70">Checking owner session…</p>
      </Shell>
    );
  }

  if (gate === "denied") {
    return (
      <Shell tone="admin">
        <div className="max-w-xl space-y-4 font-mono text-sm">
          <pre className="whitespace-pre-wrap border border-[var(--term-line)] bg-black/40 p-4 text-[var(--phosphor)]">
            {asciiBox("ACCESS", ["Owner session required.", "Sign in as the bound owner account."])}
          </pre>
          <Link href="/sign-in">
            <Button variant="term">Sign in</Button>
          </Link>
          <Link href="/">
            <Button variant="term">Back to watch</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell tone="admin">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--phosphor)]/60">server.hasnain.us</p>
          <h1 className="font-mono text-2xl text-[var(--phosphor)]">Homelab console</h1>
          <p className="max-w-2xl font-mono text-xs text-[var(--phosphor)]/70">
            Read-only cluster metrics when configured. Missing collectors stay unknown. Preflight rows are historical, not live.
          </p>
          <SectionNav active={section} onSelect={setSection} />
        </header>

        {message ? <p className="font-mono text-xs text-amber-200">{message}</p> : null}

        {section === "cluster" ? (
          <div className="space-y-6">
            {clusterError ? (
              <p className="font-mono text-sm text-red-300">{clusterError}</p>
            ) : null}
            {cluster?.live.error ? (
              <pre className="whitespace-pre-wrap border border-amber-400/40 bg-amber-400/5 p-3 font-mono text-xs text-amber-100">
                {asciiBox("LIVE FEED", [cluster.live.error, "Panels below show unknown until Proxmox responds."])}
              </pre>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-3">
              {(cluster?.live.nodes ?? []).map((node) => (
                <pre
                  key={node.id}
                  className="overflow-x-auto whitespace-pre border border-[var(--term-line)] bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-[var(--phosphor)]"
                >
                  {nodePanel(node, preflightById.get(node.id))}
                </pre>
              ))}
            </div>
            {cluster ? (
              <pre className="whitespace-pre-wrap border border-[var(--term-line)] bg-black/30 p-3 font-mono text-xs text-[var(--phosphor)]/80">
                {asciiBox("AGGREGATE", [
                  `quorum (live): ${cluster.live.quorum ?? "unknown"}`,
                  `quorum (preflight ${cluster.preflight.collectedAt}): ${cluster.preflight.quorum}`,
                  `source: ${cluster.preflight.source}`,
                ])}
              </pre>
            ) : null}
            {cluster?.audit?.length ? (
              <div className="space-y-2">
                <h2 className="font-mono text-sm uppercase tracking-widest text-[var(--phosphor)]/80">Recent audit</h2>
                <ul className="space-y-1 font-mono text-xs text-[var(--phosphor)]/70">
                  {cluster.audit.slice(0, 8).map((row, index) => (
                    <li key={`${row.createdAt}-${index}`}>
                      {row.createdAt} · {row.action} · {row.target} · {row.result}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button variant="term" onClick={() => loadCluster().catch(() => setClusterError("Refresh failed."))}>
              Refresh cluster
            </Button>
          </div>
        ) : null}

        {section === "users" ? (
          <div className="space-y-6 font-mono text-sm">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={async (event) => {
                event.preventDefault();
                setMessage("");
                setInviteCode(null);
                const { ok, data } = await api<{ invite?: { code: string }; error?: string }>("/api/admin/users", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "invite", email: inviteEmail }),
                });
                if (!ok) setMessage(data.error ?? "Invite failed.");
                else {
                  setInviteCode(data.invite?.code ?? null);
                  setInviteEmail("");
                  loadUsers().catch(() => undefined);
                }
              }}
            >
              <Input
                className="border-[var(--term-line)] bg-black/40 font-mono text-[var(--phosphor)]"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Family email"
              />
              <Button type="submit" variant="term">
                Issue invite
              </Button>
            </form>
            {inviteCode ? (
              <p className="text-[var(--phosphor)]">
                Invite code (shown once): <span className="text-[var(--sand)]">{inviteCode}</span>
              </p>
            ) : null}
            <div className="overflow-x-auto border border-[var(--term-line)]">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-black/40 text-[var(--phosphor)]/60">
                  <tr>
                    <th className="p-2">Email</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Quotas</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-[var(--term-line)]">
                      <td className="p-2">{user.email}</td>
                      <td className="p-2">{user.role}</td>
                      <td className="p-2">{user.status}</td>
                      <td className="p-2">
                        req {user.requestQuota} · strm {user.streamQuota} · {user.remoteBitrateKbps} kbps
                        {user.allow4k ? " · 4k" : ""}
                      </td>
                      <td className="p-2">
                        {user.role === "owner" ? (
                          <span className="text-[var(--phosphor)]/50">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(["active", "suspended", "revoked"] as const).map((status) => (
                              <Button
                                key={status}
                                variant="term"
                                className="px-2 py-1 text-[10px]"
                                onClick={async () => {
                                  await api("/api/admin/users", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "status", userId: user.id, status }),
                                  });
                                  loadUsers().catch(() => undefined);
                                }}
                              >
                                {status}
                              </Button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {section === "media" ? (
          <div className="space-y-6 font-mono text-sm">
            <div>
              <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--phosphor)]/70">Library</h2>
              <ul className="space-y-2">
                {mediaRows.map((item) => (
                  <li key={item.id} className="border border-[var(--term-line)] bg-black/30 p-3 text-xs">
                    {item.title} · {item.available_pieces}/{item.piece_count} pieces · {item.request_state}
                  </li>
                ))}
                {mediaRows.length === 0 ? <li className="text-[var(--phosphor)]/60">No media rows yet.</li> : null}
              </ul>
            </div>
            <div>
              <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--phosphor)]/70">Requests</h2>
              <ul className="space-y-2">
                {requests.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-[var(--term-line)] bg-black/30 p-3 text-xs"
                  >
                    <span>
                      {item.title} · {item.email} · {item.state}
                    </span>
                    {item.state === "requested" ? (
                      <div className="flex gap-1">
                        <Button
                          variant="term"
                          className="px-2 py-1 text-[10px]"
                          onClick={async () => {
                            await api("/api/admin/media", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "state", id: item.id, state: "approved" }),
                            });
                            loadMedia().catch(() => undefined);
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="term"
                          className="px-2 py-1 text-[10px]"
                          onClick={async () => {
                            await api("/api/admin/media", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "state", id: item.id, state: "denied" }),
                            });
                            loadMedia().catch(() => undefined);
                          }}
                        >
                          Deny
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
                {requests.length === 0 ? <li className="text-[var(--phosphor)]/60">No pending requests.</li> : null}
              </ul>
            </div>
          </div>
        ) : null}

        {section === "services" ? (
          <div className="space-y-6 font-mono text-sm">
            <p className="text-xs text-[var(--phosphor)]/70">
              Management worker: {workerConfigured ? "configured" : "not configured — power actions refuse."}
              {" · "}
              Deploy agent: {agentConfigured ? "configured" : "not configured"}
            </p>
            <ul className="space-y-2">
              {guests.map((guest) => (
                <li key={guest.id} className="border border-[var(--term-line)] bg-black/30 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {guest.id} (VM {guest.vmid}) — {guest.note}
                    </span>
                    <div className="flex gap-1">
                      {(["start", "shutdown"] as const).map((action) => (
                        <Button
                          key={action}
                          variant="term"
                          className="px-2 py-1 text-[10px]"
                          onClick={async () => {
                            const { ok, data } = await api<{ message?: string }>("/api/admin/guests", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ guest: guest.id, action }),
                            });
                            setMessage(data.message ?? (ok ? "Accepted." : "Refused."));
                          }}
                        >
                          {action}
                        </Button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--phosphor)]/70">Deploy plans</h2>
              <ul className="space-y-1 text-xs text-[var(--phosphor)]/80">
                {deployPlans.map((plan) => (
                  <li key={plan.id}>
                    {plan.createdAt} · {plan.body.name} on {plan.body.targetGuest} · {plan.status} · {plan.digest.slice(0, 12)}…
                  </li>
                ))}
                {deployPlans.length === 0 ? <li>No deploy previews yet.</li> : null}
              </ul>
            </div>
          </div>
        ) : null}

        {section === "mcp" ? (
          <div className="space-y-4 font-mono text-sm">
            <pre className="whitespace-pre-wrap border border-[var(--term-line)] bg-black/40 p-4 text-xs text-[var(--phosphor)]">
              {asciiBox("MCP TOOLS (READ-ONLY)", [
                ...(mcpTools.length ? mcpTools : ["(loading…)"]),
                "",
                "Apply and shell tools are not exposed.",
              ])}
            </pre>
            <Button variant="term" onClick={() => loadMcp().catch(() => setMessage("Could not reload MCP list."))}>
              Reload tool list
            </Button>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
