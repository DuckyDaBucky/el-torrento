import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL } from "../src/lib/access";
import {
  bootstrapOwner,
  getOwner,
  getUserByClerkId,
  loginExisting,
  resetDbForTests,
} from "../src/lib/db";

beforeEach(() => {
  process.env.ELTORRENTO_DB = ":memory:";
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.ELTORRENTO_DB;
});

describe("bootstrapOwner binding", () => {
  it("binds owner to clerk user id for bootstrap email", () => {
    const clerkUserId = "user_bootstrap_1";
    const result = bootstrapOwner({
      clerkUserId,
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.user.role, "owner");
    assert.equal(result.user.email, BOOTSTRAP_OWNER_EMAIL);
    const owner = getOwner();
    assert.equal(owner?.clerk_user_id, clerkUserId);
    assert.equal(getUserByClerkId(clerkUserId)?.id, result.user.id);
  });

  it("rejects second bootstrap attempt", () => {
    bootstrapOwner({
      clerkUserId: "user_owner",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    const second = bootstrapOwner({
      clerkUserId: "user_other",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(second.ok, false);
  });

  it("logs in returning owner by clerk id, not email string alone", () => {
    const bound = bootstrapOwner({
      clerkUserId: "user_owner_real",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(bound.ok, true);

    const wrongId = loginExisting({
      clerkUserId: "user_wrong",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(wrongId.ok, false);

    const ok = loginExisting({
      clerkUserId: "user_owner_real",
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    assert.equal(ok.ok, true);
  });
});
