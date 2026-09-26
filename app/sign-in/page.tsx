"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const router = useRouter();
  const [ownerExists, setOwnerExists] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [recover, setRecover] = useState("");

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then((data) => {
        setOwnerExists(Boolean(data.ownerExists));
        if (data.user) router.replace(data.user.role === "owner" ? "/admin" : "/");
      })
      .catch(() => setError("Could not reach the sign-in service."));
  }, [router]);

  async function post(body: object) {
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
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
            The owner is the Google account for hasnainmn7@gmail.com, bound once to a Clerk user id.
            Without Clerk keys, the button below creates that binding locally and shows a recovery code.
            Typing the email later does not sign you in.
          </p>
        </div>

        {!ownerExists ? (
          <Button onClick={() => post({ action: "bootstrap" })}>Create owner access</Button>
        ) : (
          <p className="text-sm text-[var(--muted)]">Owner access already exists. Use the recovery code if the session is gone.</p>
        )}

        {recoveryCode ? (
          <div className="rounded-md border border-[var(--sand)] bg-black/40 p-4">
            <p className="text-sm">Save this recovery code. It is shown once and replaces the previous one.</p>
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
          <h2 className="text-lg">Owner recovery</h2>
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
          <h2 className="text-lg">Family invite</h2>
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email on the invite" />
          <Input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Invite code" />
          <Button type="submit" variant="ghost">
            Accept invite
          </Button>
        </form>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
    </Shell>
  );
}
