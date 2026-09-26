import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import { backupDatabase } from "../src/lib/backup";
import { bootstrapOwner, resetDbForTests } from "../src/lib/db";

let tempDir: string | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "el-torrento-backup-"));
  process.env.ELTORRENTO_DB = path.join(tempDir, "app.sqlite");
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.ELTORRENTO_DB;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("backupDatabase", () => {
  it("copies the sqlite file after owner bootstrap", () => {
    const owner = bootstrapOwner({
      clerkUserId: "user_owner_backup",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(owner.ok, true);

    const backupPath = backupDatabase();
    assert.ok(existsSync(backupPath));
    assert.match(backupPath, /app-\d+\.sqlite$/);
  });
});
