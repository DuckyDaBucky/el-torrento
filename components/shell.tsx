"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Session = {
  user: { id: string; email: string; role: string; status: string } | null;
  devAuth: boolean;
  clerk: boolean;
};

export function Shell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "watch" | "admin";
}) {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  return (
    <div className={tone === "admin" ? "min-h-screen bg-[var(--term)] text-[var(--phosphor)]" : "min-h-screen"}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-8">
        <div className="flex items-baseline gap-4">
          <Link href="/" className="text-lg tracking-tight">
            El Torrento
          </Link>
          {tone === "admin" ? (
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--phosphor)]/70">
              server
            </span>
          ) : (
            <span className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">watch</span>
          )}
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/">
            <Button variant={tone === "admin" ? "term" : "ghost"}>Watch</Button>
          </Link>
          {session?.user?.role === "owner" ? (
            <Link href="/admin">
              <Button variant={tone === "admin" ? "term" : "ghost"}>Admin</Button>
            </Link>
          ) : null}
          {session?.user ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "logout" }),
                });
                location.href = "/sign-in";
              }}
            >
              <Button type="submit" variant={tone === "admin" ? "term" : "ghost"}>
                Sign out
              </Button>
            </form>
          ) : (
            <Link href="/sign-in">
              <Button variant={tone === "admin" ? "term" : "default"}>Sign in</Button>
            </Link>
          )}
        </nav>
      </header>
      {session && !session.clerk ? (
        <p className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100 md:px-8">
          Clerk is not configured, so this browser is using a local session. It is not Google sign-in.
        </p>
      ) : null}
      <main className="px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
