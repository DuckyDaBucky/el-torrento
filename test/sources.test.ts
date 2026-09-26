import assert from "node:assert/strict";
import test from "node:test";
import { resetDbForTests, getDb } from "../src/lib/db";
import { listIndexerSources, selectTestedIndexerIds, setIndexerSource, type IndexerSource } from "../src/lib/sources";

test("indexer sources start disabled", () => {
  process.env.ELTORRENTO_DB = ":memory:";
  resetDbForTests();
  const sources = listIndexerSources();
  assert.ok(sources.length >= 3);
  assert.ok(sources.every((item) => !item.enabled));
  assert.ok(sources.find((item) => item.id === "torrentleech")?.kind === "private");
});

test("cannot enable without tested flag", () => {
  process.env.ELTORRENTO_DB = ":memory:";
  resetDbForTests();
  const owner = {
    id: "usr_owner",
    clerk_user_id: "c1",
    email: "owner@test",
    role: "owner" as const,
    status: "active" as const,
    recovery_hash: null,
    created_at: new Date().toISOString(),
    request_quota: 5,
    stream_quota: 2,
    remote_bitrate_kbps: 4000,
    allow_4k: 1,
  };
  getDb()
    .prepare(
      `INSERT INTO users (id, clerk_user_id, email, role, status, recovery_hash, created_at, allow_4k)
       VALUES (?, ?, ?, 'owner', 'active', NULL, ?, 1)`,
    )
    .run(owner.id, owner.clerk_user_id, owner.email, owner.created_at);
  assert.throws(() => setIndexerSource(owner, "1337x", { enabled: true }), /tested/);
  const enabled = setIndexerSource(owner, "1337x", { tested: true, enabled: true });
  assert.equal(enabled.enabled, true);
});

test("only tested indexers are eligible to search", () => {
  const local: IndexerSource[] = [
    {
      id: "1337x",
      label: "1337x",
      kind: "public",
      prowlarrDefinition: "1337x",
      enabled: false,
      tested: false,
      notes: null,
    },
    {
      id: "eztv",
      label: "EZTV",
      kind: "public",
      prowlarrDefinition: "eztv",
      enabled: true,
      tested: true,
      notes: null,
    },
  ];
  const ids = selectTestedIndexerIds(local, [
    { id: 1, name: "1337x", definitionName: "1337x" },
    { id: 2, name: "EZTV", definitionName: "eztv" },
    { id: 3, name: "Nyaa", definitionName: "nyaa" },
  ]);
  assert.deepEqual(ids, [2]);
});
