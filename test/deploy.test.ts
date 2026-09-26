import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDigest, validateDeploy, type DeployRequest } from "../src/lib/deploy";

const validPlan: DeployRequest = {
  name: "qbittorrent",
  targetGuest: "media-ingest",
  image: "ghcr.io/example/qbittorrent@sha256:abc123def456789012345678901234567890123456789012345678901234",
  cpu: 1,
  memoryMb: 512,
  diskMb: 4096,
  ports: [8080],
  network: "bridge",
  secretRefs: ["qbittorrent-admin"],
  volumes: ["/mnt/downloads:/data"],
  healthcheck: "curl -f localhost:8080",
  restart: "unless-stopped",
};

describe("validateDeploy", () => {
  it("accepts a pinned ingest plan", () => {
    assert.equal(validateDeploy(validPlan).length, 0);
  });

  it("rejects unpinned images and host network", () => {
    const issues = validateDeploy({
      ...validPlan,
      image: "nginx:latest",
      network: "host",
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
    });
    assert.ok(issues.some((issue) => issue.field === "image"));
    assert.ok(issues.some((issue) => issue.field === "network"));
    assert.ok(issues.some((issue) => issue.field === "volumes"));
  });

  it("rejects proxmox host targets", () => {
    const issues = validateDeploy({ ...validPlan, targetGuest: "pve-5050" });
    assert.ok(issues.some((issue) => issue.field === "targetGuest"));
  });
});

describe("planDigest", () => {
  it("is stable for the same payload", () => {
    assert.equal(planDigest(validPlan), planDigest({ ...validPlan }));
  });
});
