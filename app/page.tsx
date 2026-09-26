"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Media = {
  id: string;
  title: string;
  height: number;
  request_state: string;
  available_pieces: number;
  piece_count: number;
  hdr: string | null;
  audio_codec: string;
};

export default function WatchHome() {
  const [media, setMedia] = useState<Media[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const auth = await fetch("/api/auth", { credentials: "include" }).then((res) => res.json());
    setSignedIn(Boolean(auth.user));
    if (!auth.user) return;
    const res = await fetch("/api/media", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    setMedia(data.media ?? []);
  }

  useEffect(() => {
    load().catch(() => setError("Could not load the library."));
  }, []);

  return (
    <Shell tone="watch">
      <section className="mb-10 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--sand)]">At home</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-6xl">What is ready to watch</h1>
        <p className="mt-4 max-w-xl text-[var(--muted)]">
          Playback starts from verified pieces. Seeking past a hole waits. Quality never upscales, and 4K stays hidden until an encoder path is real.
        </p>
      </section>

      {!signedIn ? (
        <Link href="/sign-in">
          <Button>Sign in to watch</Button>
        </Link>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((item) => (
              <Link
                key={item.id}
                href={`/watch/${item.id}`}
                className="group overflow-hidden rounded-xl border border-white/10 bg-[var(--card)]"
              >
                <div className="relative h-44 bg-[radial-gradient(circle_at_30%_20%,#e4b07a,transparent_40%),linear-gradient(160deg,#1b2430,#0c0d10)]">
                  <div className="absolute bottom-3 left-3 font-mono text-xs text-white/80">
                    {item.height}p · {item.hdr ?? "SDR"} · {item.audio_codec}
                  </div>
                </div>
                <div className="space-y-1 p-4">
                  <h2 className="text-xl">{item.title}</h2>
                  <p className="text-sm text-[var(--muted)]">
                    {item.available_pieces}/{item.piece_count} pieces verified · {item.request_state}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          {media.length === 0 ? (
            <p className="text-[var(--muted)]">The library is empty until a torrent is added on the ingest engine.</p>
          ) : null}

          <form
            className="mt-10 flex max-w-xl flex-col gap-3 sm:flex-row"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              const res = await fetch("/api/media", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              });
              const data = await res.json();
              if (!res.ok) setError(data.error ?? "Request failed.");
              else {
                setTitle("");
                setError("Request recorded. It stays requested until the owner approves it.");
              }
            }}
          >
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Request a title" />
            <Button type="submit">Request</Button>
          </form>
          {error ? <p className="mt-3 text-sm text-[var(--muted)]">{error}</p> : null}
        </>
      )}
    </Shell>
  );
}
