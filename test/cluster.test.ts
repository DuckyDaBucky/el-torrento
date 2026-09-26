import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectLiveNodes, layoutNodes, NODE_ORDER, type LiveNode } from "../src/lib/cluster";

describe("NODE_ORDER", () => {
  it("keeps physical layout 5050 left, 3040a center, 3040b right", () => {
    assert.deepEqual(
      NODE_ORDER.map((node) => node.id),
      ["pve-5050", "pve3040a", "pve-3040b"],
    );
    assert.deepEqual(
      NODE_ORDER.map((node) => node.title),
      ["5050", "3040a", "3040b"],
    );
  });
});

describe("layoutNodes", () => {
  it("puts a shuffled payload back into left, center, right", () => {
    const reversed = [...NODE_ORDER].reverse().map(
      (meta): LiveNode => ({
        id: meta.id,
        title: meta.title,
        model: meta.model,
        ip: meta.ip,
        online: "online",
        stale: false,
        uptime: "1h",
        cpu: "10%",
        ram: "1 / 2 MiB",
        storage: null,
        thinPool: null,
        diskHealth: null,
        rxTx: null,
        guests: null,
        temperature: null,
        warnings: [],
        checkedAt: "2026-09-26T00:00:00.000Z",
        reason: null,
      }),
    );
    assert.deepEqual(
      layoutNodes(reversed).map((node) => node.id),
      ["pve-5050", "pve3040a", "pve-3040b"],
    );
  });

  it("fills a missing node with unknown instead of shifting the row", () => {
    const laid = layoutNodes([]);
    assert.equal(laid.length, 3);
    assert.ok(laid.every((node) => node.online === "unknown" && node.stale && node.cpu === null));
  });
});

describe("collectLiveNodes without Proxmox token", () => {
  it("returns unknown nodes with an honest reason", async () => {
    const live = await collectLiveNodes({ env: {} });
    assert.equal(live.nodes.length, 3);
    assert.ok(live.error);
    assert.ok(live.nodes.every((node) => node.online === "unknown" && node.stale));
    assert.ok(live.nodes.every((node) => node.cpu === null && node.ram === null && node.diskHealth === null));
    assert.equal(JSON.stringify(live).includes("5.0 GiB"), false);
  });
});

describe("collectLiveNodes when Proxmox is unreachable", () => {
  it("does not invent a healthy reading", async () => {
    const live = await collectLiveNodes({
      env: { PVE_URL: "https://pve.example", PVE_TOKEN_ID: "id", PVE_TOKEN_SECRET: "secret" },
      fetchImpl: async () => {
        throw new Error("connect EHOSTUNREACH");
      },
    });
    assert.match(live.error ?? "", /EHOSTUNREACH/);
    assert.deepEqual(
      live.nodes.map((node) => node.id),
      ["pve-5050", "pve3040a", "pve-3040b"],
    );
    assert.ok(live.nodes.every((node) => node.online === "unknown" && node.stale));
    assert.ok(live.nodes.every((node) => node.cpu === null && node.ram === null && node.temperature === null));
  });

  it("treats an empty status body as unknown", async () => {
    const live = await collectLiveNodes({
      env: { PVE_URL: "https://pve.example", PVE_TOKEN_ID: "id", PVE_TOKEN_SECRET: "secret" },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/cluster/status")) {
          return new Response(JSON.stringify({ data: [{ type: "cluster", quorate: 1 }] }), { status: 200 });
        }
        if (url.includes("/nodes/pve-5050/")) {
          return new Response(
            JSON.stringify({ data: { uptime: 7200, cpu: 0.2, memory: { used: 1048576, total: 2097152 } } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      },
    });
    const left = live.nodes[0];
    assert.equal(left.id, "pve-5050");
    assert.equal(left.online, "online");
    assert.equal(left.stale, false);
    assert.equal(left.cpu, "20%");
    assert.equal(left.diskHealth, null);
    assert.equal(left.temperature, null);
    assert.equal(live.nodes[1].online, "unknown");
    assert.equal(live.nodes[1].stale, true);
    assert.equal(live.nodes[1].cpu, null);
    assert.equal(live.nodes[2].online, "unknown");
  });
});
