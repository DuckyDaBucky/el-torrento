import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapOwner,
  createInvite,
  getOwner,
  readSession,
  resetDbForTests,
  acceptInvite,
} from "../src/lib/db";

describe("auth isolation", () => {
  it("viewer session is not owner", () => {
    resetDbForTests();
    process.env.ELTORRENTO_DB = ":memory:";
    bootstrapOwner({
      clerkUserId: "owner_1",
      email: "hasnainmn7@gmail.com",
      emailVerified: true,
    });
    const owner = getOwner();
    assert.ok(owner);
    const invite = createInvite(owner!, "family@example.com");
    const viewer = acceptInvite(
      { clerkUserId: "viewer_1", email: "family@example.com", emailVerified: true },
      invite.code,
    );
    assert.equal(viewer.ok, true);
    if (!viewer.ok) return;
    const user = readSession(viewer.sessionId);
    assert.equal(user?.role, "viewer");
  });
});
