import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { bootstrapOwner, getDb, resetDbForTests } from "../src/lib/db";
import { backupDatabase } from "../src/lib/backup";

describe("backupDatabase", () => {
  it("copies sqlite file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "et-backup-"));
    const dbFile = path.join(dir, "app.sqlite");
    process.env.ELTORRENTO_DB = dbFile;
    resetDbForTests();
    bootstrapOwner({
      clerkUserId: "owner_bk",
      email: "hasnainmn7@gmail.com",
      emailVerified: true,
    });
    getDb();
    const backup = backupDatabase(dbFile, path.join(dir, "backups"));
    assert.match(backup, /app-\d+\.sqlite$/);
    rmSync(dir, { recursive: true, force: true });
  });
});
