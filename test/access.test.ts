import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOOTSTRAP_OWNER_EMAIL, decideFirstContact } from "../src/lib/access";

describe("decideFirstContact", () => {
  it("binds bootstrap owner on first contact with verified bootstrap email", () => {
    const decision = decideFirstContact({
      owner: null,
      identity: {
        clerkUserId: "user_abc",
        email: BOOTSTRAP_OWNER_EMAIL,
        emailVerified: true,
      },
      invitedEmail: null,
    });
    assert.equal(decision.action, "bind-owner");
  });

  it("rejects unverified email", () => {
    const decision = decideFirstContact({
      owner: null,
      identity: {
        clerkUserId: "user_abc",
        email: BOOTSTRAP_OWNER_EMAIL,
        emailVerified: false,
      },
      invitedEmail: null,
    });
    assert.equal(decision.action, "reject");
  });

  it("does not grant owner from email alone when owner already exists", () => {
    const decision = decideFirstContact({
      owner: { id: "usr_1", clerkUserId: "user_real", email: BOOTSTRAP_OWNER_EMAIL },
      identity: {
        clerkUserId: "user_attacker",
        email: BOOTSTRAP_OWNER_EMAIL,
        emailVerified: true,
      },
      invitedEmail: null,
    });
    assert.equal(decision.action, "reject");
    assert.match(decision.reason, /already bound/i);
  });

  it("accepts invite when email matches pending invite", () => {
    const decision = decideFirstContact({
      owner: { id: "usr_1", clerkUserId: "user_owner", email: BOOTSTRAP_OWNER_EMAIL },
      identity: {
        clerkUserId: "user_viewer",
        email: "family@example.com",
        emailVerified: true,
      },
      invitedEmail: "family@example.com",
    });
    assert.equal(decision.action, "bind-viewer");
  });
});
