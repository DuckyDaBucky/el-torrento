export const BOOTSTRAP_OWNER_EMAIL = "hasnainmn7@gmail.com";

export type Identity = {
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
};

export type OwnerRecord = {
  id: string;
  clerkUserId: string;
  email: string;
};

export type AccessDecision =
  | { action: "bind-owner"; reason: string }
  | { action: "bind-viewer"; reason: string }
  | { action: "reject"; reason: string };

/**
 * First contact only. Returning sessions are looked up by stored user id,
 * never by a matching email string.
 */
export function decideFirstContact(input: {
  owner: OwnerRecord | null;
  identity: Identity;
  invitedEmail: string | null;
}): AccessDecision {
  const email = input.identity.email.trim().toLowerCase();
  if (!input.identity.emailVerified) {
    return { action: "reject", reason: "Email is not verified." };
  }
  if (!input.identity.clerkUserId) {
    return { action: "reject", reason: "Missing account id." };
  }

  if (!input.owner) {
    if (email === BOOTSTRAP_OWNER_EMAIL) {
      return {
        action: "bind-owner",
        reason: "Bootstrap owner bound to this account id.",
      };
    }
    return {
      action: "reject",
      reason: "No invite matches this account.",
    };
  }

  if (input.identity.clerkUserId === input.owner.clerkUserId) {
    return { action: "reject", reason: "Account is already registered." };
  }

  if (email === input.owner.email.trim().toLowerCase()) {
    return {
      action: "reject",
      reason: "That email is already bound to a different account id.",
    };
  }

  if (input.invitedEmail && input.invitedEmail.trim().toLowerCase() === email) {
    return { action: "bind-viewer", reason: "Invite accepted." };
  }

  return { action: "reject", reason: "No invite matches this account." };
}
