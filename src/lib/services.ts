import type { UserRow } from "./db";
import { saveServiceLink } from "./db";

type FetchLike = typeof fetch;

export async function syncJellyfin(input: {
  user: UserRow;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; error?: string; externalId?: string }> {
  if (!input.baseUrl || !input.apiKey) {
    saveServiceLink(input.user.id, "jellyfin", null, "Jellyfin is not configured.");
    return { ok: false, error: "Jellyfin is not configured." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const disabled = input.user.status === "suspended" || input.user.status === "revoked";
  try {
    const response = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/Users/New`, {
      method: "POST",
      headers: {
        "X-Emby-Token": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Name: input.user.id,
        Policy: { IsDisabled: disabled },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const error = `Jellyfin HTTP ${response.status}`;
      saveServiceLink(input.user.id, "jellyfin", null, error);
      return { ok: false, error };
    }
    const body = (await response.json()) as { Id?: string };
    const externalId = body.Id ?? null;
    saveServiceLink(input.user.id, "jellyfin", externalId, null);
    return { ok: true, externalId: externalId ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Jellyfin sync failed.";
    saveServiceLink(input.user.id, "jellyfin", null, message);
    return { ok: false, error: message };
  }
}

export async function syncSeerr(input: {
  user: UserRow;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; error?: string; externalId?: string }> {
  if (!input.baseUrl || !input.apiKey) {
    saveServiceLink(input.user.id, "seerr", null, "Seerr is not configured.");
    return { ok: false, error: "Seerr is not configured." };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/api/v1/user`, {
      method: "POST",
      headers: {
        "X-Api-Key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.user.email,
        permissions: input.user.role === "owner" ? 2 : 32,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const error = `Seerr HTTP ${response.status}`;
      saveServiceLink(input.user.id, "seerr", null, error);
      return { ok: false, error };
    }
    const body = (await response.json()) as { id?: number };
    const externalId = body.id != null ? String(body.id) : null;
    saveServiceLink(input.user.id, "seerr", externalId, null);
    return { ok: true, externalId: externalId ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seerr sync failed.";
    saveServiceLink(input.user.id, "seerr", null, message);
    return { ok: false, error: message };
  }
}
