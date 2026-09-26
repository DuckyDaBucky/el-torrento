import type { UserRow } from "./db";
import { audit } from "./db";

export const APPROVED_GUESTS = [
  { id: "media-playback", vmid: 100, note: "VM 100. Power is not delegated." },
  { id: "media-storage", vmid: 101, note: "Storage. Shutdown drops the library export." },
  { id: "media-apps", vmid: 102, note: "Apps VM 192.168.4.52. Power is not delegated." },
  { id: "media-ingest", vmid: 103, note: "Downloader only." },
] as const;

const POWERABLE = new Set(["media-storage", "media-ingest"]);
const ACTIONS = new Set(["start", "shutdown"]);
const POWER_OFF = new Set(["stop", "poweroff", "power-off", "reset", "reboot", "suspend", "delete"]);
const NOT_DELEGATED = new Set(["media-playback", "media-apps", "100", "102", "192.168.4.52"]);

export type GuestActionResult = {
  ok: boolean;
  status: number;
  message: string;
  upstreamTaskId: string | null;
};

/**
 * Allowlisted power calls. Without a management worker URL this refuses
 * instead of talking to Proxmox from the dashboard process.
 */
export async function requestGuestAction(input: {
  actor: UserRow;
  guest: string;
  action: string;
  idempotencyKey: string;
  workerUrl: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<GuestActionResult> {
  if (input.actor.role !== "owner" || input.actor.status !== "active") {
    return { ok: false, status: 403, message: "Owner access is required.", upstreamTaskId: null };
  }
  if (POWER_OFF.has(input.action)) {
    audit(input.actor.id, input.action, input.guest, "rejected", "Power off is not allowlisted.");
    return {
      ok: false,
      status: 403,
      message: "Power off is not allowlisted. VM 100 and the apps VM .52 cannot be powered off.",
      upstreamTaskId: null,
    };
  }
  if (!ACTIONS.has(input.action)) {
    audit(input.actor.id, input.action, input.guest, "rejected", "Action is not allowlisted.");
    return {
      ok: false,
      status: 403,
      message: "That action is not available. Only start and shutdown are allowlisted.",
      upstreamTaskId: null,
    };
  }
  if (NOT_DELEGATED.has(input.guest)) {
    audit(input.actor.id, input.action, input.guest, "rejected", "VM 100 and apps VM .52 are not delegated.");
    return {
      ok: false,
      status: 403,
      message: "VM 100 and the apps VM .52 cannot be powered off or started from here.",
      upstreamTaskId: null,
    };
  }
  if (!POWERABLE.has(input.guest)) {
    audit(input.actor.id, input.action, input.guest, "rejected", "Guest is not approved.");
    return { ok: false, status: 403, message: "That guest is not approved.", upstreamTaskId: null };
  }
  if (input.guest === "media-storage" && input.action === "shutdown") {
    /* allowed, but the message names the consequence */
  }
  if (!input.workerUrl) {
    audit(input.actor.id, input.action, input.guest, "not-configured", input.idempotencyKey);
    const warning =
      input.guest === "media-storage"
        ? " Shutdown would drop the library export for playback and ingest."
        : "";
    return {
      ok: false,
      status: 501,
      message: `Management worker is not configured. Nothing was changed.${warning}`,
      upstreamTaskId: null,
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.workerUrl.replace(/\/$/, "")}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guest: input.guest,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
    }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json().catch(() => ({}))) as { taskId?: string; message?: string };
  const result = response.ok ? "ok" : "error";
  audit(input.actor.id, input.action, input.guest, result, body.taskId ?? input.idempotencyKey);
  return {
    ok: response.ok,
    status: response.status,
    message: body.message ?? (response.ok ? "Accepted." : "Worker refused the action."),
    upstreamTaskId: body.taskId ?? null,
  };
}
