export type AppRole = "full" | "admin" | "watch";

export function appRole(): AppRole {
  const raw = process.env.ELTORRENTO_ROLE?.trim().toLowerCase();
  if (raw === "admin" || raw === "watch") return raw;
  return "full";
}

/** Only the admin/full process may open SQLite and run owner mutations. */
export function opensDatabase(): boolean {
  return appRole() !== "watch";
}

export function adminApiEnabled(): boolean {
  const role = appRole();
  return role === "full" || role === "admin";
}

export function watchSurfaceEnabled(): boolean {
  const role = appRole();
  return role === "full" || role === "watch";
}

export function internalApiBase(): string | undefined {
  const base = process.env.INTERNAL_API_URL?.replace(/\/$/, "");
  return base || undefined;
}
