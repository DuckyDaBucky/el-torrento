import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { getDb, resetDbForTests, dbPath } from "./db";

export function backupDatabase(source = dbPath(), destDir = path.join(process.cwd(), "data", "backups")): string {
  if (source === ":memory:") {
    throw new Error("In-memory databases have no file to copy.");
  }
  if (!existsSync(source)) throw new Error("Database file is missing.");
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `app-${Date.now()}.sqlite`);
  getDb().exec("PRAGMA wal_checkpoint(FULL)");
  copyFileSync(source, dest);
  return dest;
}

export function restoreDatabase(backup: string, target = dbPath()): void {
  if (!existsSync(backup)) throw new Error("Backup file is missing.");
  if (target === backup) throw new Error("Refusing to restore a file onto itself.");
  resetDbForTests();
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(backup, target);
  for (const suffix of ["-wal", "-shm"]) {
    const extra = `${target}${suffix}`;
    if (existsSync(extra)) rmSync(extra);
  }
}
