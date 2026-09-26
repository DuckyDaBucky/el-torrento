import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BOOTSTRAP_OWNER_EMAIL, decideFirstContact, type Identity } from "./access";
import { opensDatabase } from "./runtime";

export type Role = "owner" | "viewer";
export type UserStatus = "pending" | "active" | "suspended" | "revoked";

export type UserRow = {
  id: string;
  clerk_user_id: string;
  email: string;
  role: Role;
  status: UserStatus;
  recovery_hash: string | null;
  created_at: string;
  request_quota: number;
  stream_quota: number;
  remote_bitrate_kbps: number;
  allow_4k: number;
};

export type PublicUser = {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  requestQuota: number;
  streamQuota: number;
  remoteBitrateKbps: number;
  allow4k: boolean;
  links: { service: string; externalId: string | null; syncError: string | null }[];
};

let db: DatabaseSync | null = null;

export function dbPath(): string {
  return process.env.ELTORRENTO_DB ?? path.join(process.cwd(), "data", "app.sqlite");
}

export function resetDbForTests(): void {
  db?.close();
  db = null;
}

export function getDb(): DatabaseSync {
  if (!opensDatabase()) {
    throw new Error("This process does not open the app database. Use the admin API service.");
  }
  if (db) return db;
  const file = dbPath();
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      recovery_hash TEXT,
      created_at TEXT NOT NULL,
      request_quota INTEGER NOT NULL DEFAULT 5,
      stream_quota INTEGER NOT NULL DEFAULT 2,
      remote_bitrate_kbps INTEGER NOT NULL DEFAULT 4000,
      allow_4k INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS invites (
      code_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_links (
      user_id TEXT NOT NULL,
      service TEXT NOT NULL,
      external_id TEXT,
      sync_error TEXT,
      PRIMARY KEY (user_id, service)
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      height INTEGER NOT NULL,
      video_codec TEXT NOT NULL,
      audio_codec TEXT NOT NULL,
      hdr TEXT,
      delivery_confirmed INTEGER NOT NULL DEFAULT 0,
      request_state TEXT NOT NULL,
      available_pieces INTEGER NOT NULL,
      piece_count INTEGER NOT NULL,
      piece_size INTEGER NOT NULL,
      file_path TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      encoder_2160 INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS playback (
      user_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      position_sec REAL NOT NULL DEFAULT 0,
      profile TEXT NOT NULL,
      PRIMARY KEY (user_id, media_id)
    );
    CREATE TABLE IF NOT EXISTS media_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deploy_plans (
      id TEXT PRIMARY KEY,
      body_json TEXT NOT NULL,
      digest TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "media", "duration_sec", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "media_requests", "seerr_request_id", "TEXT");
  ensureColumn(db, "media_requests", "tmdb_id", "TEXT");
  ensureColumn(db, "media_requests", "media_type", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexer_sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      prowlarr_definition TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      tested INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );
  `);
  seedIndexerSources(db);
  return db;
}

function seedIndexerSources(database: DatabaseSync): void {
  const defaults: { id: string; label: string; kind: string; prowlarr_definition: string | null; notes: string }[] = [
    { id: "1337x", label: "1337x", kind: "public", prowlarr_definition: "1337x", notes: "Disabled until search is verified." },
    { id: "eztv", label: "EZTV", kind: "public", prowlarr_definition: "eztv", notes: "Disabled until search is verified." },
    { id: "nyaa", label: "Nyaa", kind: "public", prowlarr_definition: "nyaa", notes: "Optional; disabled by default." },
    { id: "torrentleech", label: "TorrentLeech", kind: "private", prowlarr_definition: null, notes: "Off unless access and client rules are confirmed." },
  ];
  const insert = database.prepare(
    `INSERT INTO indexer_sources (id, label, kind, prowlarr_definition, enabled, tested, notes)
     VALUES (?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const row of defaults) {
    insert.run(row.id, row.label, row.kind, row.prowlarr_definition, row.notes);
  }
}

function ensureColumn(database: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function now(): string {
  return new Date().toISOString();
}

export function getOwner(): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE role = 'owner'").get() as UserRow | undefined;
}

export function getUser(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getUserByClerkId(clerkUserId: string): UserRow | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE clerk_user_id = ?")
    .get(clerkUserId) as UserRow | undefined;
}

function rowToPublic(row: UserRow): PublicUser {
  const links = getDb()
    .prepare("SELECT service, external_id, sync_error FROM service_links WHERE user_id = ?")
    .all(row.id) as { service: string; external_id: string | null; sync_error: string | null }[];
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    requestQuota: row.request_quota,
    streamQuota: row.stream_quota,
    remoteBitrateKbps: row.remote_bitrate_kbps,
    allow4k: row.allow_4k === 1,
    links: links.map((link) => ({
      service: link.service,
      externalId: link.external_id,
      syncError: link.sync_error,
    })),
  };
}

export function listUsers(): PublicUser[] {
  const rows = getDb().prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[];
  return rows.map(rowToPublic);
}

function issueSession(userId: string): string {
  const id = newId("ses");
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at, revoked) VALUES (?, ?, ?, 0)")
    .run(id, userId, expires);
  return id;
}

export function readSession(sessionId: string | undefined): UserRow | null {
  if (!sessionId) return null;
  const row = getDb()
    .prepare(
      "SELECT user_id, expires_at, revoked FROM sessions WHERE id = ?",
    )
    .get(sessionId) as { user_id: string; expires_at: string; revoked: number } | undefined;
  if (!row || row.revoked) return null;
  if (row.expires_at < now()) return null;
  const user = getUser(row.user_id);
  if (!user || user.status === "revoked" || user.status === "suspended") return null;
  return user;
}

export function revokeSessions(userId: string): number {
  const result = getDb()
    .prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0")
    .run(userId);
  return Number(result.changes);
}

export type AuthResult =
  | { ok: true; user: UserRow; sessionId: string; recoveryCode?: string }
  | { ok: false; status: number; error: string };

export function bootstrapOwner(identity: Identity): AuthResult {
  const decision = decideFirstContact({
    owner: ownerRecord(),
    identity,
    invitedEmail: null,
  });
  if (decision.action !== "bind-owner") {
    return { ok: false, status: 403, error: decision.reason };
  }
  const recoveryCode = randomBytes(18).toString("base64url");
  const userId = newId("usr");
  getDb()
    .prepare(
      `INSERT INTO users (
        id, clerk_user_id, email, role, status, recovery_hash, created_at, allow_4k
      ) VALUES (?, ?, ?, 'owner', 'active', ?, ?, 1)`,
    )
    .run(userId, identity.clerkUserId, identity.email.trim().toLowerCase(), hashSecret(recoveryCode), now());
  audit(userId, "bootstrap-owner", userId, "ok", "Bound bootstrap email to account id.");
  const user = getUser(userId)!;
  return { ok: true, user, sessionId: issueSession(userId), recoveryCode };
}

function ownerRecord() {
  const owner = getOwner();
  if (!owner) return null;
  return { id: owner.id, clerkUserId: owner.clerk_user_id, email: owner.email };
}

export function acceptInvite(identity: Identity, inviteCode: string): AuthResult {
  const existingUser = getUserByClerkId(identity.clerkUserId);
  if (existingUser) {
    return { ok: false, status: 403, error: "Account is already registered." };
  }
  const codeHash = hashSecret(inviteCode.trim());
  const invite = getDb()
    .prepare("SELECT email, status FROM invites WHERE code_hash = ?")
    .get(codeHash) as { email: string; status: string } | undefined;
  if (!invite || invite.status !== "pending") {
    return { ok: false, status: 403, error: "Invite is not valid." };
  }
  if (identity.email.trim().toLowerCase() !== invite.email) {
    return { ok: false, status: 403, error: "This invite was issued for a different email." };
  }
  const decision = decideFirstContact({
    owner: ownerRecord(),
    identity,
    invitedEmail: invite.email,
  });
  if (decision.action !== "bind-viewer") {
    return { ok: false, status: 403, error: decision.reason };
  }
  const userId = newId("usr");
  getDb()
    .prepare(
      `INSERT INTO users (
        id, clerk_user_id, email, role, status, recovery_hash, created_at
      ) VALUES (?, ?, ?, 'viewer', 'active', NULL, ?)`,
    )
    .run(userId, identity.clerkUserId, invite.email, now());
  getDb().prepare("UPDATE invites SET status = 'accepted' WHERE code_hash = ?").run(codeHash);
  audit(userId, "accept-invite", userId, "ok", null);
  return { ok: true, user: getUser(userId)!, sessionId: issueSession(userId) };
}

export function recoverOwner(recoveryCode: string): AuthResult {
  const owner = getOwner();
  if (!owner || !owner.recovery_hash) {
    return { ok: false, status: 403, error: "Owner recovery is not available." };
  }
  const given = Buffer.from(hashSecret(recoveryCode.trim()));
  const stored = Buffer.from(owner.recovery_hash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    return { ok: false, status: 403, error: "Recovery code is not valid." };
  }
  const nextCode = randomBytes(18).toString("base64url");
  getDb().prepare("UPDATE users SET recovery_hash = ? WHERE id = ?").run(hashSecret(nextCode), owner.id);
  audit(owner.id, "recover-owner", owner.id, "ok", "Recovery code rotated.");
  return { ok: true, user: owner, sessionId: issueSession(owner.id), recoveryCode: nextCode };
}

export function loginExisting(identity: Identity): AuthResult {
  const user = getUserByClerkId(identity.clerkUserId);
  if (!user) return { ok: false, status: 403, error: "No account is bound to this id." };
  if (user.status !== "active") {
    return { ok: false, status: 403, error: `Account is ${user.status}.` };
  }
  if (!identity.emailVerified) {
    return { ok: false, status: 403, error: "Email is not verified." };
  }
  return { ok: true, user, sessionId: issueSession(user.id) };
}

export function createInvite(actor: UserRow, email: string): { code: string; email: string } {
  assertOwner(actor);
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a real email address.");
  }
  if (normalized === BOOTSTRAP_OWNER_EMAIL) {
    throw new Error("That address is the owner bootstrap, not a family invite.");
  }
  const existing = getDb().prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (existing) throw new Error("That email already has an account.");
  const code = randomBytes(12).toString("base64url");
  getDb()
    .prepare("INSERT INTO invites (code_hash, email, status, created_at) VALUES (?, ?, 'pending', ?)")
    .run(hashSecret(code), normalized, now());
  audit(actor.id, "create-invite", normalized, "ok", null);
  return { code, email: normalized };
}

export function setUserStatus(actor: UserRow, userId: string, status: UserStatus): void {
  assertOwner(actor);
  const target = getUser(userId);
  if (!target) throw new Error("User not found.");
  if (target.role === "owner") throw new Error("The owner account cannot be suspended here.");
  getDb().prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
  if (status === "suspended" || status === "revoked") {
    revokeSessions(userId);
    getDb()
      .prepare("DELETE FROM playback WHERE user_id = ?")
      .run(userId);
  }
  audit(actor.id, `user-${status}`, userId, "ok", null);
}

export function updateQuotas(
  actor: UserRow,
  userId: string,
  quotas: { requestQuota: number; streamQuota: number; remoteBitrateKbps: number; allow4k: boolean },
): void {
  assertOwner(actor);
  const target = getUser(userId);
  if (!target || target.role === "owner") throw new Error("Quotas apply to family accounts.");
  getDb()
    .prepare(
      `UPDATE users SET request_quota = ?, stream_quota = ?, remote_bitrate_kbps = ?, allow_4k = ? WHERE id = ?`,
    )
    .run(
      quotas.requestQuota,
      quotas.streamQuota,
      quotas.remoteBitrateKbps,
      quotas.allow4k ? 1 : 0,
      userId,
    );
  audit(actor.id, "update-quotas", userId, "ok", null);
}

export function saveServiceLink(
  userId: string,
  service: "jellyfin" | "seerr",
  externalId: string | null,
  syncError: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO service_links (user_id, service, external_id, sync_error)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, service) DO UPDATE SET external_id = excluded.external_id, sync_error = excluded.sync_error`,
    )
    .run(userId, service, externalId, syncError);
}

export function getServiceLink(userId: string, service: "jellyfin" | "seerr"): string | null {
  const row = getDb()
    .prepare("SELECT external_id FROM service_links WHERE user_id = ? AND service = ?")
    .get(userId, service) as { external_id: string | null } | undefined;
  return row?.external_id ?? null;
}

export function assertOwner(user: UserRow): void {
  if (user.role !== "owner" || user.status !== "active") {
    throw new Error("Owner access is required.");
  }
}

export function audit(
  actorId: string | null,
  action: string,
  target: string,
  result: string,
  detail: string | null,
): void {
  getDb()
    .prepare(
      "INSERT INTO audit (id, actor_id, action, target, result, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(newId("aud"), actorId, action, target, result, detail, now());
}

export function listAudit(limit = 30): { action: string; target: string; result: string; createdAt: string }[] {
  return getDb()
    .prepare(
      "SELECT action, target, result, created_at as createdAt FROM audit ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as { action: string; target: string; result: string; createdAt: string }[];
}

export function devAuthEnabled(): boolean {
  if (process.env.CLERK_SECRET_KEY) return false;
  if (process.env.ALLOW_DEV_AUTH === "0") return false;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") return false;
  return true;
}

export function devBootstrapIdentity(): Identity {
  return {
    clerkUserId: `dev:${BOOTSTRAP_OWNER_EMAIL}`,
    email: BOOTSTRAP_OWNER_EMAIL,
    emailVerified: true,
  };
}

export { BOOTSTRAP_OWNER_EMAIL };
