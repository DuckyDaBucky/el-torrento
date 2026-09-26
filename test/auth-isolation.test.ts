import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import { GET as clusterGet } from "../app/api/admin/cluster/route";
import { GET as usersGet } from "../app/api/admin/users/route";
import { GET as mediaGet } from "../app/api/admin/media/route";
import { GET as guestsGet } from "../app/api/admin/guests/route";
import { GET as deployGet } from "../app/api/admin/deploy/route";
import { POST as backupPost } from "../app/api/admin/backup/route";
import {
  acceptInvite,
  bootstrapOwner,
  createInvite,
  resetDbForTests,
} from "../src/lib/db";

const ADMIN_HANDLERS = [
  { name: "cluster", handler: clusterGet },
  { name: "users", handler: usersGet },
  { name: "media", handler: mediaGet },
  { name: "guests", handler: guestsGet },
  { name: "deploy", handler: deployGet },
] as const;

function requestWithSession(sessionId: string, path: string): Request {
  return new Request(path, {
    headers: { cookie: `et_session=${encodeURIComponent(sessionId)}` },
  });
}

beforeEach(() => {
  process.env.ELTORRENTO_DB = ":memory:";
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.ELTORRENTO_DB;
});

describe("admin API auth isolation", () => {
  it("viewer sessions cannot read admin GET routes", async () => {
    const owner = bootstrapOwner({
      clerkUserId: "user_owner",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(owner.ok, true);
    if (!owner.ok) return;

    const invite = createInvite(owner.user, "family@example.com");
    const viewer = acceptInvite(
      { clerkUserId: "user_viewer", email: "family@example.com", emailVerified: true },
      invite.code,
    );
    assert.equal(viewer.ok, true);
    if (!viewer.ok) return;

    for (const route of ADMIN_HANDLERS) {
      const res = await route.handler(
        requestWithSession(viewer.sessionId, `http://localhost/api/admin/${route.name}`),
      );
      assert.equal(res.status, 403, `${route.name} should reject viewers`);
    }

    const backup = await backupPost(
      requestWithSession(viewer.sessionId, "http://localhost/api/admin/backup"),
    );
    assert.equal(backup.status, 403);
  });

  it("owner session can reach users admin API", async () => {
    const owner = bootstrapOwner({
      clerkUserId: "user_owner_2",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(owner.ok, true);
    if (!owner.ok) return;

    const res = await usersGet(
      requestWithSession(owner.sessionId, "http://localhost/api/admin/users"),
    );
    assert.equal(res.status, 200);
  });
});
