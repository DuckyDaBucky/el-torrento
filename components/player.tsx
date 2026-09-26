"use client";

import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";

type Manifest = {
  title: string;
  availablePieces: number;
  pieceCount: number;
  profiles: { id: string; bitrate?: string }[];
  badge: { showSuccess: boolean; label: string; detail: string };
  position: number;
};

export function Player({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ignoreSeek = useRef(false);
  const pendingTime = useRef(0);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [profile, setProfile] = useState("original");
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  async function refresh() {
    const res = await fetch(`/api/media/${id}`, { credentials: "include" });
    if (!res.ok) return;
    setManifest(await res.json());
  }

  useEffect(() => {
    refresh().catch(() => setError("Could not load this title."));
    const timer = setInterval(() => refresh().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !generation) return;
    const playProfile = profile === "auto" ? "original" : profile;
    ignoreSeek.current = true;
    video.src = `/api/media/${id}/content?g=${generation}&profile=${playProfile}`;
    const onLoad = () => {
      const target = pendingTime.current;
      if (target > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(target, Math.max(0, video.duration - 0.1));
      }
      video.play().catch(() => undefined);
      window.setTimeout(() => {
        ignoreSeek.current = false;
      }, 400);
    };
    video.addEventListener("loadedmetadata", onLoad, { once: true });
  }, [generation, id, profile]);

  async function begin(nextProfile: string) {
    setError("");
    setHint("");
    const res = await fetch(`/api/media/${id}/play`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: nextProfile === "auto" ? "original" : nextProfile }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Playback refused.");
      return;
    }
    pendingTime.current = 0;
    setProfile(nextProfile);
    setGeneration(data.generation);
  }

  return (
    <Shell tone="watch">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl">{manifest?.title ?? "Player"}</h1>
            <p className="text-sm text-[var(--muted)]">
              {manifest ? `${manifest.availablePieces}/${manifest.pieceCount} pieces verified` : "Loading"}
            </p>
          </div>
          {manifest ? (
            <p className={manifest.badge.showSuccess ? "text-sm text-[var(--sand)]" : "text-sm text-amber-200"}>
              {manifest.badge.label}
              <span className="mt-1 block text-[var(--muted)]">{manifest.badge.detail}</span>
            </p>
          ) : null}
        </div>

        <video
          ref={videoRef}
          controls
          playsInline
          className="aspect-video w-full rounded-lg bg-black"
          onSeeked={async () => {
            const video = videoRef.current;
            if (!video || ignoreSeek.current || !generation) return;
            const seconds = video.currentTime;
            const res = await fetch(`/api/media/${id}/seek`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                seconds,
                profile: profile === "auto" ? "original" : profile,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              setError(data.error ?? "Seek failed.");
              return;
            }
            pendingTime.current = seconds;
            setGeneration(data.generation);
          }}
          onWaiting={() => {
            if (profile === "auto") {
              const has480 = manifest?.profiles.some((item) => item.id === "480p");
              if (has480) {
                setHint("Switched toward 480p because the download is behind the playhead.");
                begin("480p").catch(() => undefined);
              }
            } else {
              setHint("Buffering. Manual quality stays here. Auto can drop a level if you switch.");
            }
          }}
        />

        <div className="flex flex-wrap gap-2">
          {(manifest?.profiles ?? []).map((item) => (
            <Button
              key={item.id}
              variant={profile === item.id ? "default" : "ghost"}
              onClick={() => begin(item.id)}
            >
              {item.id}
              {item.bitrate ? ` · ${item.bitrate}` : ""}
            </Button>
          ))}
        </div>
        {hint ? <p className="text-sm text-[var(--muted)]">{hint}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <p className="text-xs text-[var(--muted)]">
          This browser is not a television. HDR is not claimed for the screen, only for a delivery path that was actually checked.
        </p>
      </div>
    </Shell>
  );
}
