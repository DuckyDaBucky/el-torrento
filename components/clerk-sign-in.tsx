"use client";

import { SignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Shell } from "@/components/shell";

export function ClerkSignIn() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.user) router.replace(data.user.role === "owner" ? "/admin" : "/");
      })
      .catch(() => undefined);
  }, [router]);

  return (
    <Shell tone="watch">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-6">
        <div className="w-full text-center">
          <h1 className="text-3xl">Sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Google sign-in via Clerk. The bootstrap owner binds on first verified sign-in for the configured email.
          </p>
        </div>
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-in" fallbackRedirectUrl="/api/auth/clerk-sync" />
      </div>
    </Shell>
  );
}
