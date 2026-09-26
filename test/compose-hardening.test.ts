import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../../el-torrento-infra");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function servicesOf(text: string): { name: string; body: string }[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "services:");
  assert.ok(start >= 0);
  const services: { name: string; body: string }[] = [];
  let current: { name: string; body: string } | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^[^ #\s]/.test(line)) break;
    const match = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (match) {
      if (current) services.push(current);
      current = { name: match[1], body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) services.push(current);
  return services;
}

const composeFiles = [
  "compose/media-apps.compose.yml",
  "compose/media-playback.compose.yml",
  "compose/media-ingest.compose.yml",
];

describe("compose files for docker-compose 1.29", () => {
  it("sets healthchecks, restart policy, limits, and private networks", () => {
    for (const file of composeFiles) {
      const text = read(file);
      assert.match(text, /version: "2\.4"/, file);
      assert.equal(text.includes("PIN_BEFORE_USE"), false, file);
      assert.equal(text.includes("docker.sock"), false, file);
      assert.equal(text.includes("network_mode:"), false, file);
      assert.match(text, /driver: bridge/, file);
      for (const service of servicesOf(text)) {
        assert.match(service.body, /mem_limit:/, `${file} ${service.name}`);
        assert.match(service.body, /cpus:/, `${file} ${service.name}`);
        assert.match(service.body, /healthcheck:/, `${file} ${service.name}`);
        assert.match(service.body, /restart: unless-stopped/, `${file} ${service.name}`);
        assert.match(service.body, /networks:/, `${file} ${service.name}`);
      }
    }
  });

  it("mounts SQLite only on the api service", () => {
    const services = servicesOf(read("compose/media-apps.compose.yml"));
    const sqlite = services.filter((service) => /app-data|app\.sqlite|ELTORRENTO_DB/.test(service.body));
    assert.deepEqual(
      sqlite.map((service) => service.name),
      ["api"],
    );
  });

  it("keeps the management worker unpublished", () => {
    const worker = servicesOf(read("compose/media-apps.compose.yml")).find((service) => service.name === "mgmt-worker");
    assert.ok(worker);
    assert.equal(worker.body.includes("ports:"), false);
    assert.match(worker.body, /user: "node"/);
    assert.match(worker.body, /networks: \[mgmt\]/);
  });

  it("documents the NFS writer check and does not start containers from that script", () => {
    const ingest = read("compose/media-ingest.compose.yml");
    assert.match(ingest, /require-nfs-mount\.sh \/mnt\/downloads/);
    assert.match(ingest, /do not start containers/);
    const script = read("scripts/require-nfs-mount.sh");
    assert.equal(/docker/i.test(script), false);
    assert.match(script, /Do not start writer containers/);
    const dir = mkdtempSync(path.join(tmpdir(), "el-torrento-nfs-"));
    try {
      const failed = spawnSync(path.join(root, "scripts/require-nfs-mount.sh"), [dir], { encoding: "utf8" });
      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, /Do not start writer containers/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Caddy", () => {
  it("proxies admin, watch, and Jellyfin, and says video stays off the free tunnel", () => {
    const caddy = read("caddy/Caddyfile");
    assert.match(caddy, /Admin may use Cloudflare Access/);
    assert.match(caddy, /Video must not use the free Cloudflare tunnel/);
    assert.match(caddy, /server\.hasnain\.us \{[\s\S]*reverse_proxy api:3847/);
    assert.match(caddy, /watch\.hasnain\.us \{[\s\S]*reverse_proxy watch:3847/);
    assert.match(caddy, /media\.hasnain\.us \{[\s\S]*reverse_proxy 192\.168\.4\.50:8096/);
  });
});
