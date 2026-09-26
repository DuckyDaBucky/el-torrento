import { createHash } from "node:crypto";

export type DeployRequest = {
  name: string;
  targetGuest: string;
  image: string;
  cpu: number;
  memoryMb: number;
  diskMb: number;
  ports: number[];
  network: string;
  secretRefs: string[];
  volumes: string[];
  healthcheck: string;
  restart: string;
  hostname?: string;
};

export type DeployIssue = { field: string; message: string };

const APPROVED_GUESTS = new Set(["media-apps", "media-playback", "media-ingest", "media-storage"]);
const INGEST_IMAGES = new Set(["qbittorrent", "libtorrent-engine"]);

export function validateDeploy(input: DeployRequest): DeployIssue[] {
  const issues: DeployIssue[] = [];
  if (!input.name.trim()) issues.push({ field: "name", message: "Name is required." });
  if (!APPROVED_GUESTS.has(input.targetGuest)) {
    issues.push({
      field: "targetGuest",
      message: "That guest is not an approved target. Proxmox hosts are not targets.",
    });
  }
  if (input.targetGuest === "media-ingest") {
    const short = input.image.split("/").pop()?.split("@")[0] ?? "";
    if (!INGEST_IMAGES.has(short) && !INGEST_IMAGES.has(input.name)) {
      issues.push({
        field: "targetGuest",
        message: "The ingest VM only runs qBittorrent or the libtorrent engine.",
      });
    }
  }
  if (!input.image.includes("@sha256:")) {
    issues.push({
      field: "image",
      message: "Image must be pinned with @sha256. Tags and :latest are rejected.",
    });
  }
  if (/:latest\b/.test(input.image)) {
    issues.push({ field: "image", message: "latest is not allowed." });
  }
  const blob = `${input.image} ${input.volumes.join(" ")} ${input.network}`.toLowerCase();
  if (input.network === "host" || blob.includes("network_mode") && blob.includes("host")) {
    issues.push({ field: "network", message: "Host network is rejected." });
  }
  if (blob.includes("docker.sock") || blob.includes("/var/run/docker.sock")) {
    issues.push({ field: "volumes", message: "The Docker socket is rejected." });
  }
  if (blob.includes("privileged")) {
    issues.push({ field: "volumes", message: "Privileged mode is rejected." });
  }
  for (const volume of input.volumes) {
    if (volume.startsWith("/") && !volume.startsWith("/mnt/")) {
      issues.push({
        field: "volumes",
        message: `Volume ${volume} is outside /mnt. Host root is rejected.`,
      });
    }
  }
  if (input.cpu < 0.1 || input.cpu > 4) {
    issues.push({ field: "cpu", message: "CPU must be between 0.1 and 4." });
  }
  if (input.memoryMb < 64 || input.memoryMb > 8192) {
    issues.push({ field: "memoryMb", message: "Memory must be between 64 and 8192 MB." });
  }
  if (input.secretRefs.some((ref) => ref.includes("=") || ref.includes("\n"))) {
    issues.push({
      field: "secretRefs",
      message: "Secret refs are names only. Do not paste secret values.",
    });
  }
  return issues;
}

export function planDigest(input: DeployRequest): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
