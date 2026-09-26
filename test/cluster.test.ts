import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectLiveNodes, NODE_ORDER } from "../src/lib/cluster";

describe("NODE_ORDER", () => {
  it("keeps physical layout 5050 left, 3040a center, 3040b right", () => {
    assert.deepEqual(
      NODE_ORDER.map((node) => node.title),
      ["5050", "3040a", "3040b"],
    );
  });
});

describe("collectLiveNodes without Proxmox token", () => {
  it("returns unknown nodes with an honest reason", async () => {
    const live = await collectLiveNodes({ env: {} });
    assert.equal(live.nodes.length, 3);
    assert.ok(live.error);
    assert.ok(live.nodes.every((node) => node.online === "unknown"));
  });
});
