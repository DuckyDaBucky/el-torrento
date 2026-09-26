"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClerkSignIn } from "./clerk-sign-in";

export function DevSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const [ownerExists, setOwnerExists] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [recover, setRecover] = useState("");
  const [clerkEnabled, setClerkEnabled] = useState(false);
  const [devAuth, setDevAuth] = useState(false);

  useEffect(() => {
    setError(params.get("error") ?? "");
    fetch("/api/auth", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setOwnerExists(Boolean(data.ownerExists));
        setClerkEnabled(Boolean(data.clerk));
        setDevAuth(Boolean(data.devAuth));
        if (data.user) router.replace(data.user.role === "owner" ? "/admin" : "/");
      })
      .catch(() => setError("Could not reach the sign-in service."));
  }, [router, params]);

  async function post(body: object) {
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Sign-in failed.");
      return;
    }
    if (data.recoveryCode) setRecoveryCode(data.recoveryCode);
    else router.push(data.user?.role === "owner" ? "/admin" : "/");
  }

  return (
    <Shell tone="watch">
      <div className="mx-auto max-w-lg space-y-8">
        <div>
          <h1 className="text-3xl">Sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Google sign-in runs through Clerk when keys are configured. The owner bootstrap binds{" "}
            <strong>hasnainmn7@gmail.com</strong> once to a Clerk user id. A matching email on a later account does not
            grant owner.
          </p>
        </div>

        {clerkEnabled ? (
          <>
            <ClerkSignIn />
            <p className="text-xs text-[var(--muted)]">
              Family invite? Add <code className="text-[var(--sand)]">?invite=CODE</code> to the URL before signing in
              with Google.
            </p>
          </>
        ) : null}

        {devAuth ? (
          <>
            {!ownerExists ? (
              <Button onClick={() => post({ action: "bootstrap" })}>Create owner access (dev only)</Button>
            ) : (
              <p className="text-sm text-[var(--muted)]">Dev mode: owner exists. Use recovery or Clerk in production.</p>
            )}
            {recoveryCode ? (
              <div className="rounded-md border border-[var(--sand)] bg-black/40 p-4">
                <p className="text-sm">Save this recovery code. It is shown once.</p>
                <p className="mt-2 break-all font-mono text-[var(--sand)]">{recoveryCode}</p>
                <Button className="mt-4" onClick={() => router.push("/admin")}>
                  Continue
                </Button>
              </div>
            ) : null}
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                post({ action: "recover", recoveryCode: recover });
              }}
            >
              <h2 className="text-lg">Owner recovery (dev)</h2>
              <Input value={recover} onChange={(event) => setRecover(event.target.value)} placeholder="Recovery code" />
              <Button type="submit" variant="ghost">
                Restore owner session
              </Button>
            </form>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                post({ action: "accept", inviteCode, email });
              }}
            >
              <h2 className="text-lg">Family invite (dev)</h2>
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email on the invite" />
              <Input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Invite code" />
              <Button type="submit" variant="ghost">
                Accept invite
              </Button>
            </form>
          </>
        ) : null}

        {!clerkEnabled && !devAuth ? (
          <p className="text-sm text-amber-200">Set CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to sign in.</p>
        ) : null}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
    </Shell>
  );
}
