import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDownloadDir } from "../src/lib/storage-guard";

describe("resolveDownloadDir", () => {
  it("returns path when NFS is mounted under /mnt/downloads", () => {
    assert.equal(resolveDownloadDir(true, "/mnt/downloads/incoming"), "/mnt/downloads/incoming");
  });

  it("refuses when NFS is not mounted", () => {
    assert.throws(
      () => resolveDownloadDir(false, "/mnt/downloads/incoming"),
      /NFS is not mounted/i,
    );
  });

  it("rejects paths outside /mnt/downloads", () => {
    assert.throws(() => resolveDownloadDir(true, "/tmp/downloads"), /only be written under/i);
  });
});
