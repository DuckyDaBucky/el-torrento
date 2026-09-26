import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

describe("sqlite-backup.sh", () => {
  it("restores to an isolated file and leaves the live database unchanged", () => {
    assert.ok(tempDir);
    const live = path.join(tempDir!, "live.sqlite");
    const opened = new DatabaseSync(live);
    opened.exec("CREATE TABLE sample (value TEXT)");
    opened.prepare("INSERT INTO sample (value) VALUES (?)").run("original");
    opened.close();

    const script = path.join(import.meta.dirname, "../../el-torrento-infra/scripts/sqlite-backup.sh");
    const backup = spawnSync(script, ["backup", live, tempDir!], { encoding: "utf8" });
    assert.equal(backup.status, 0, backup.stderr);
    const backupPath = backup.stdout.trim();
    assert.ok(existsSync(backupPath));

    const changed = new DatabaseSync(live);
    changed.prepare("UPDATE sample SET value = ?").run("changed");
    changed.close();

    const isolated = path.join(tempDir!, "restored.sqlite");
    const restored = spawnSync(script, ["restore-isolated", backupPath, isolated, live], { encoding: "utf8" });
    assert.equal(restored.status, 0, restored.stderr);

    const liveAfter = new DatabaseSync(live, { readOnly: true });
    const liveRow = liveAfter.prepare("SELECT value FROM sample").get() as { value: string };
    liveAfter.close();
    assert.equal(liveRow.value, "changed");

    const isolatedDb = new DatabaseSync(isolated, { readOnly: true });
    const isolatedRow = isolatedDb.prepare("SELECT value FROM sample").get() as { value: string };
    isolatedDb.close();
    assert.equal(isolatedRow.value, "original");

    const refused = spawnSync(script, ["restore-isolated", backupPath, live, live], { encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /live database/);

    const still = new DatabaseSync(live, { readOnly: true });
    const stillRow = still.prepare("SELECT value FROM sample").get() as { value: string };
    still.close();
    assert.equal(stillRow.value, "changed");
  });
});
