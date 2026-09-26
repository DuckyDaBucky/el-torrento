"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { keptPosition } from "@/src/lib/pieces";
import { deliveryBadge, type ProfileId, type SourceFacts } from "@/src/lib/quality";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";

type Manifest = {
  title: string;
  availablePieces: number;
  pieceCount: number;
  profiles: { id: string; bitrate?: string }[];
  sourceFacts: SourceFacts;
  badge: { showSuccess: boolean; label: string; detail: string };
  position: number;
  profile: string;
  generation: number;
};

export function Player({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const ignoreSeek = useRef(false);
  const pendingTime = useRef(0);
  const autoDropped = useRef(false);
  const waitingSince = useRef<number | null>(null);
  const waitingTimer = useRef<number | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [profile, setProfile] = useState("original");
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  async function refresh() {
    const res = await fetch(`/api/media/${id}`, { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as Manifest;
    setManifest(data);
    if (generation === 0 && data.generation > 0) {
      setGeneration(data.generation);
      setProfile(data.profile);
    }
  }

  useEffect(() => {
    refresh().catch(() => setError("Could not load this title."));
    const timer = setInterval(() => refresh().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [id]);

  const activeProfile = (profile as ProfileId) || "original";
  const badge = useMemo(() => {
    if (!manifest?.sourceFacts) return manifest?.badge ?? null;
    return deliveryBadge(manifest.sourceFacts, activeProfile);
  }, [manifest, activeProfile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !generation) return;
    const playProfile = profile === "auto" ? "original" : profile;
    const target = pendingTime.current;
    ignoreSeek.current = true;
    hlsRef.current?.destroy();
    hlsRef.current = null;

    const resume = () => {
      if (target > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(target, Math.max(0, video.duration - 0.05));
      } else if (target > 0) {
        video.currentTime = target;
      }
      video.play().catch(() => undefined);
      window.setTimeout(() => {
        ignoreSeek.current = false;
      }, 400);
    };

    if (playProfile === "original") {
      video.src = `/api/media/${id}/content?g=${generation}&profile=original`;
      video.addEventListener("loadedmetadata", resume, { once: true });
      return;
    }

    const src = `/api/media/${id}/hls/${generation}/${playProfile}/index.m3u8`;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, resume);
      hls.on(Hls.Events.ERROR, () => setHint("Buffering verified pieces for this quality."));
      return () => {
        hls.destroy();
      };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", resume, { once: true });
    }
  }, [generation, id, profile]);

  function currentPosition(): number {
    return keptPosition(videoRef.current?.currentTime ?? 0, manifest?.position ?? 0);
  }

  async function changePlayback(nextProfile: string, position: number) {
    setError("");
    pendingTime.current = position;
    const res = await fetch(`/api/media/${id}/playback`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quality: nextProfile,
        positionSeconds: position,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Playback refused.");
      return;
    }
    setProfile(nextProfile);
    setGeneration(data.generation);
  }

  async function begin(nextProfile: string) {
    await changePlayback(nextProfile, currentPosition());
  }

  return (
    <Shell tone="watch">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl">{manifest?.title ?? "Player"}</h1>
            <p className="text-sm text-[var(--muted)]">
              {manifest ? `${manifest.availablePieces}/${manifest.pieceCount} verified` : "Loading"}
              {activeProfile ? ` · ${activeProfile === "auto" ? "auto" : activeProfile}` : ""}
            </p>
          </div>
          {badge ? (
            <p className={badge.showSuccess ? "text-sm text-[var(--sand)]" : "text-sm text-amber-200"}>
              {badge.label}
              <span className="mt-1 block text-[var(--muted)]">{badge.detail}</span>
            </p>
          ) : null}
        </div>

        <video
          ref={videoRef}
          controls
          playsInline
          className="aspect-video w-full rounded-lg bg-black"
          onError={() => setHint("Buffering. Missing pieces are downloading; this is not a bad range.")}
          onSeeked={async () => {
            const video = videoRef.current;
            if (!video || ignoreSeek.current || !generation) return;
            const seconds = video.currentTime;
            await changePlayback(profile === "auto" ? "auto" : profile, seconds);
          }}
          onWaiting={() => {
            if (profile !== "auto" || autoDropped.current) {
              setHint("Buffering verified pieces. Manual quality keeps this position.");
              return;
            }
            const video = videoRef.current;
            if (!video) return;
            const now = Date.now();
            if (waitingSince.current == null) waitingSince.current = now;
            if (waitingTimer.current != null) return;
            waitingTimer.current = window.setTimeout(() => {
              waitingTimer.current = null;
              const elapsed = Date.now() - (waitingSince.current ?? now);
              const rate = video.playbackRate;
              if (elapsed < 2500 || rate > 0 && video.readyState >= 2) {
                waitingSince.current = null;
                return;
              }
              const order = ["2160p", "1080p", "720p", "480p"];
              const current = profile === "auto" ? "original" : profile;
              const idx = order.indexOf(current);
              const next = order.slice(idx + 1).find((id) => manifest?.profiles.some((p) => p.id === id));
              waitingSince.current = null;
              if (!next) return;
              autoDropped.current = true;
              setHint(`Auto stepped down to ${next} after sustained buffering.`);
              begin(next).catch(() => undefined);
            }, 2600);
          }}
          onPlaying={() => {
            waitingSince.current = null;
            if (waitingTimer.current != null) {
              window.clearTimeout(waitingTimer.current);
              waitingTimer.current = null;
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
