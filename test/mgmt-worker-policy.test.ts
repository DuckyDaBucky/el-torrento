import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { allowedApiHosts, evaluateAction } from "../../el-torrento-infra/mgmt-worker/policy.mjs";

describe("mgmt-worker policy", () => {
  it("allowlists start and shutdown for storage and ingest only", () => {
    const start = evaluateAction({ guest: "media-ingest", action: "start" });
    assert.equal(start.ok, true);
    assert.equal(start.vmid, 103);
    assert.equal(start.node, "pve-3040b");
    assert.equal(start.endpoint, "status/start");

    const shutdown = evaluateAction({ guest: "media-storage", action: "shutdown" });
    assert.equal(shutdown.ok, true);
    assert.equal(shutdown.vmid, 101);
    assert.equal(shutdown.endpoint, "status/shutdown");
  });

  it("cannot power off VM 100 or the apps VM .52", () => {
    for (const body of [
      { guest: "media-playback", action: "shutdown" },
      { guest: "media-apps", action: "start" },
      { guest: "media-ingest", action: "stop" },
      { guest: "media-storage", action: "shutdown", vmid: 100 },
      { guest: "media-storage", action: "shutdown", address: "192.168.4.52" },
      { guest: "media-ingest", action: "start", command: "bash" },
    ]) {
      const result = evaluateAction(body);
      assert.equal(result.ok, false, JSON.stringify(body));
      assert.equal(result.status, 403, JSON.stringify(body));
    }
  });

  it("drops public Proxmox hosts", () => {
    assert.deepEqual(allowedApiHosts("192.168.4.20,example.com,192.168.4.33"), [
      "192.168.4.20",
      "192.168.4.33",
    ]);
    assert.deepEqual(allowedApiHosts("https://pve.example:8006"), []);
  });

  it("has no shell route and no Docker socket", () => {
    const worker = readFileSync(path.join(import.meta.dirname, "../../el-torrento-infra/mgmt-worker/worker.mjs"), "utf8");
    assert.equal(worker.includes("/shell"), false);
    assert.equal(worker.includes("docker.sock"), false);
    assert.match(worker, /No such endpoint/);
  });
});
