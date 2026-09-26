"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keptPosition } from "@/src/lib/pieces";
import type { SourceFacts } from "@/src/lib/quality";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";

export const MANUAL_QUALITY_KEY = "el-torrento.manualQuality";
export const SUSTAINED_BUFFER_MS = 3000;
export const AUTO_STEP_UP_COOLDOWN_MS = 20000;
export const ABR_NOTE =
  "Auto changes one rendition at a time after sustained buffer trouble, and steps up only after a cooldown. This is not a seamless multi-bitrate ladder.";

export const QUALITY_LADDER = [
  { id: "2160p", height: 2160, bitrate: "16000k" },
  { id: "1080p", height: 1080, bitrate: "8000k" },
  { id: "720p", height: 720, bitrate: "4000k" },
  { id: "480p", height: 480, bitrate: "1500k" },
] as const;

const MANUAL = new Set<string>(["original", "2160p", "1080p", "720p", "480p"]);

type StorageLike = {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
};

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

export function targetBitrate(id: string, fromApi?: string): string | undefined {
  if (fromApi) return fromApi;
  return QUALITY_LADDER.find((step) => step.id === id)?.bitrate;
}

export function visibleProfiles(
  profiles: { id: string; bitrate?: string }[],
  source: Pick<SourceFacts, "height" | "encoder2160" | "allow4k">,
): { id: string; bitrate?: string }[] {
  return profiles.filter((item) => {
    if (item.id === "auto" || item.id === "original") return true;
    const step = QUALITY_LADDER.find((row) => row.id === item.id);
    if (!step) return false;
    if (source.height < step.height) return false;
    if (step.id === "2160p" && (!source.encoder2160 || !source.allow4k)) return false;
    return true;
  });
}

/** Playable auto order. 2160p is omitted because software 4K transcode is disabled. */
export function autoLadder(offeredIds: string[], sourceHeight: number): string[] {
  const ladder: string[] = [];
  if (offeredIds.includes("original")) ladder.push("original");
  for (const step of QUALITY_LADDER) {
    if (step.id === "2160p") continue;
    if (!offeredIds.includes(step.id)) continue;
    if (step.height > sourceHeight) continue;
    ladder.push(step.id);
  }
  return ladder;
}

export function stepDown(current: string, ladder: string[]): string | null {
  const index = ladder.indexOf(current);
  if (index < 0 || index + 1 >= ladder.length) return null;
  return ladder[index + 1] ?? null;
}

export function stepUp(current: string, ladder: string[]): string | null {
  const index = ladder.indexOf(current);
  if (index <= 0) return null;
  return ladder[index - 1] ?? null;
}

export function bufferTroubleSustained(elapsedMs: number, readyState: number): boolean {
  return elapsedMs >= SUSTAINED_BUFFER_MS && readyState < 3;
}

export function canStepUp(now: number, lastChangeAt: number, stableSince: number | null): boolean {
  if (stableSince == null) return false;
  if (now - stableSince < AUTO_STEP_UP_COOLDOWN_MS) return false;
  if (now - lastChangeAt < AUTO_STEP_UP_COOLDOWN_MS) return false;
  return true;
}

export function transcodeLosses(hdr: string | null, audio: string): string[] {
  const losses: string[] = [];
  const video = (hdr ?? "").toLowerCase();
  if (video.includes("dolby vision") || video.includes("dovi")) losses.push("Dolby Vision");
  if (video.includes("hdr") || video.includes("hlg")) losses.push("HDR");
  const sound = audio.toLowerCase();
  if (sound.includes("atmos")) losses.push("Atmos");
  if (/(truehd|flac|alac|\bpcm\b|dts-hd|dts hd|mlp|lossless)/.test(sound)) losses.push("lossless audio");
  return losses;
}

export function formatLossSentence(losses: string[]): string {
  if (losses.length === 0) return "";
  if (losses.length === 1) return `This transcode drops ${losses[0]}.`;
  if (losses.length === 2) return `This transcode drops ${losses[0]} and ${losses[1]}.`;
  return `This transcode drops ${losses.slice(0, -1).join(", ")}, and ${losses[losses.length - 1]}.`;
}

export function playingLabel(input: {
  rendition: string;
  bitrate?: string;
  hdr: string | null;
  audio: string;
  deliveryConfirmed: boolean;
}): { label: string; detail: string } {
  if (input.rendition === "original") {
    if (!input.deliveryConfirmed) {
      return {
        label: "Playing original · path not confirmed",
        detail: `HDR and advanced audio are not claimed for this delivery. ${ABR_NOTE}`,
      };
    }
    return {
      label: `Playing original · ${input.hdr ?? "SDR"} · ${input.audio}`,
      detail: `Direct play of the file as stored. ${ABR_NOTE}`,
    };
  }
  const target = input.bitrate ? ` · target ${input.bitrate}` : "";
  const loss = formatLossSentence(transcodeLosses(input.hdr, input.audio));
  return {
    label: `Playing ${input.rendition} transcode${target}`,
    detail: [loss, "SDR picture, AAC stereo.", ABR_NOTE].filter(Boolean).join(" "),
  };
}

export function readStoredManualQuality(storage: StorageLike | null): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(MANUAL_QUALITY_KEY);
    if (!value || !MANUAL.has(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeStoredManualQuality(storage: StorageLike | null, profile: string | null): void {
  if (!storage?.setItem || !storage.removeItem) return;
  try {
    if (!profile || profile === "auto" || !MANUAL.has(profile)) {
      storage.removeItem(MANUAL_QUALITY_KEY);
      return;
    }
    storage.setItem(MANUAL_QUALITY_KEY, profile);
  } catch {
    /* Private browsing can reject storage writes. */
  }
}

export function resolveInitialQuality(input: {
  stored: string | null;
  offeredIds: string[];
  sourceHeight: number;
}): { profile: string; rendition: string } {
  const ladder = autoLadder(input.offeredIds, input.sourceHeight);
  const fallback = { profile: "auto", rendition: ladder[0] ?? "original" };
  if (!input.stored || input.stored === "auto") return fallback;
  if (!input.offeredIds.includes(input.stored)) return fallback;
  const step = QUALITY_LADDER.find((row) => row.id === input.stored);
  if (step && step.height > input.sourceHeight) return fallback;
  return { profile: input.stored, rendition: input.stored };
}

function buttonLabel(id: string, bitrate?: string): string {
  if (id === "auto") return "Auto";
  if (id === "original") return "Original";
  const rate = targetBitrate(id, bitrate);
  return rate ? `${id} · target ${rate}` : id;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function Player({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ignoreSeek = useRef(false);
  const pendingTime = useRef(0);
  const waitingTimer = useRef<number | null>(null);
  const stepUpTimer = useRef<number | null>(null);
  const lastChangeAt = useRef(0);
  const stableSince = useRef<number | null>(null);
  const booted = useRef(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [profile, setProfile] = useState("auto");
  const [autoRendition, setAutoRendition] = useState("original");
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const profileRef = useRef(profile);
  const renditionRef = useRef(autoRendition);
  const manifestRef = useRef(manifest);
  profileRef.current = profile;
  renditionRef.current = autoRendition;
  manifestRef.current = manifest;

  async function commitPlayback(rendition: string, position: number) {
    setError("");
    pendingTime.current = position;
    const res = await fetch(`/api/media/${id}/playback`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality: rendition, positionSeconds: position }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; generation?: number };
    if (!res.ok) {
      setError(data.error ?? "Playback refused.");
      return;
    }
    if (typeof data.generation === "number") setGeneration(data.generation);
  }

  const commitRef = useRef(commitPlayback);
  commitRef.current = commitPlayback;

  useEffect(() => {
    return () => {
      if (waitingTimer.current != null) window.clearTimeout(waitingTimer.current);
      if (stepUpTimer.current != null) window.clearTimeout(stepUpTimer.current);
    };
  }, []);

  useEffect(() => {
    booted.current = false;
    let stop = false;
    async function refresh() {
      const res = await fetch(`/api/media/${id}`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as Manifest;
      if (stop) return;
      setManifest(data);
      setError((current) => (current === "Could not load this title." ? "" : current));
    }
    refresh().catch(() => {
      if (!stop) setError("Could not load this title.");
    });
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id]);

  const offered = useMemo(
    () => (manifest ? visibleProfiles(manifest.profiles, manifest.sourceFacts) : []),
    [manifest],
  );

  useEffect(() => {
    if (!manifest || booted.current) return;
    booted.current = true;
    const offeredIds = visibleProfiles(manifest.profiles, manifest.sourceFacts).map((item) => item.id);
    const initial = resolveInitialQuality({
      stored: readStoredManualQuality(browserStorage()),
      offeredIds,
      sourceHeight: manifest.sourceFacts.height,
    });
    const position = Number.isFinite(manifest.position) ? Math.max(0, manifest.position) : 0;
    profileRef.current = initial.profile;
    renditionRef.current = initial.rendition;
    setProfile(initial.profile);
    setAutoRendition(initial.rendition);
    pendingTime.current = position;
    const playAs = initial.profile === "auto" ? initial.rendition : initial.profile;
    if (manifest.generation > 0 && manifest.profile === playAs) {
      setGeneration(manifest.generation);
      return;
    }
    void commitRef.current(playAs, position);
  }, [manifest, id]);

  const playing = profile === "auto" ? autoRendition : profile;
  const label = useMemo(() => {
    if (!manifest) return null;
    if (error) return { label: "Not playing", detail: error };
    const bitrate = targetBitrate(playing, offered.find((item) => item.id === playing)?.bitrate);
    return playingLabel({
      rendition: playing,
      bitrate,
      hdr: manifest.sourceFacts.hdr,
      audio: manifest.sourceFacts.audio,
      deliveryConfirmed: manifest.sourceFacts.deliveryConfirmed,
    });
  }, [error, manifest, offered, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !generation) return;
    const playProfile = profile === "auto" ? autoRendition : profile;
    const target = pendingTime.current;
    ignoreSeek.current = true;
    let cancelled = false;
    const holder: { hls: { destroy(): void } | null } = { hls: null };

    const resume = () => {
      if (cancelled) return;
      if (target > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(target, Math.max(0, video.duration - 0.05));
      } else if (target > 0) {
        video.currentTime = target;
      }
      video.play().catch(() => undefined);
      window.setTimeout(() => {
        ignoreSeek.current = false;
      }, 800);
    };

    if (playProfile === "original") {
      video.src = `/api/media/${id}/content?g=${generation}&profile=original`;
      video.addEventListener("loadedmetadata", resume, { once: true });
      return () => {
        cancelled = true;
        video.removeEventListener("loadedmetadata", resume);
      };
    }

    const src = `/api/media/${id}/hls/${generation}/${playProfile}/index.m3u8`;
    void (async () => {
      const loaded = await import("hls.js");
      if (cancelled) return;
      const Hls = loaded.default;
      if (Hls.isSupported()) {
        const instance = new Hls();
        holder.hls = instance;
        if (cancelled) {
          instance.destroy();
          return;
        }
        instance.loadSource(src);
        instance.attachMedia(video);
        instance.on(Hls.Events.MANIFEST_PARSED, resume);
        instance.on(Hls.Events.ERROR, () => {
          if (cancelled) return;
          if (playProfile === "2160p") {
            setError("2160p software transcode is not enabled.");
            return;
          }
          setHint("Buffering verified pieces for this quality.");
        });
        return;
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.addEventListener("loadedmetadata", resume, { once: true });
      }
    })();

    return () => {
      cancelled = true;
      holder.hls?.destroy();
      video.removeEventListener("loadedmetadata", resume);
    };
  }, [autoRendition, generation, id, profile]);

  function clearBufferTimers() {
    if (waitingTimer.current != null) {
      window.clearTimeout(waitingTimer.current);
      waitingTimer.current = null;
    }
  }

  function ladderNow(): string[] {
    const facts = manifestRef.current?.sourceFacts;
    const profiles = manifestRef.current
      ? visibleProfiles(manifestRef.current.profiles, manifestRef.current.sourceFacts).map((item) => item.id)
      : [];
    return autoLadder(profiles, facts?.height ?? 0);
  }

  function choose(next: string) {
    const position = keptPosition(videoRef.current?.currentTime ?? 0, manifestRef.current?.position ?? 0);
    clearBufferTimers();
    if (stepUpTimer.current != null) {
      window.clearTimeout(stepUpTimer.current);
      stepUpTimer.current = null;
    }
    stableSince.current = null;
    if (next === "auto") {
      writeStoredManualQuality(browserStorage(), null);
      const rendition = autoLadder(
        offered.map((item) => item.id),
        manifest?.sourceFacts.height ?? 0,
      )[0] ?? "original";
      profileRef.current = "auto";
      renditionRef.current = rendition;
      setProfile("auto");
      setAutoRendition(rendition);
      setHint("");
      void commitPlayback(rendition, position);
      return;
    }
    writeStoredManualQuality(browserStorage(), next);
    profileRef.current = next;
    renditionRef.current = next;
    setProfile(next);
    setAutoRendition(next);
    setHint("");
    void commitPlayback(next, position);
  }

  function scheduleStepUp() {
    if (stepUpTimer.current != null) window.clearTimeout(stepUpTimer.current);
    stepUpTimer.current = window.setTimeout(() => {
      stepUpTimer.current = null;
      if (profileRef.current !== "auto") return;
      const now = Date.now();
      if (!canStepUp(now, lastChangeAt.current, stableSince.current)) {
        const video = videoRef.current;
        if (video && !video.paused) scheduleStepUp();
        return;
      }
      const next = stepUp(renditionRef.current, ladderNow());
      if (!next) return;
      const video = videoRef.current;
      lastChangeAt.current = now;
      stableSince.current = now;
      renditionRef.current = next;
      setAutoRendition(next);
      setHint(`Auto stepped up to ${next} after playback held.`);
      void commitRef.current(next, keptPosition(video?.currentTime ?? 0, manifestRef.current?.position ?? 0));
    }, AUTO_STEP_UP_COOLDOWN_MS);
  }

  return (
    <Shell tone="watch">
      <div className="mx-auto max-w-4xl space-y-4 px-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl">{manifest?.title ?? "Player"}</h1>
            <p className="text-sm text-[var(--muted)]">
              {manifest ? `${manifest.availablePieces}/${manifest.pieceCount} verified pieces` : "Loading this title"}
              {manifest ? ` · ${profile === "auto" ? `Auto · ${autoRendition}` : profile}` : ""}
            </p>
          </div>
          {label ? (
            <p className={error ? "max-w-md text-sm text-amber-200" : "max-w-md text-sm text-[var(--sand)]"}>
              {label.label}
              <span className="mt-1 block text-[var(--muted)]">{label.detail}</span>
            </p>
          ) : null}
        </div>

        <video
          ref={videoRef}
          controls
          playsInline
          className="aspect-video w-full rounded-lg bg-black"
          onError={() => setHint("Buffering. Missing pieces are downloading; this is not a bad range.")}
          onSeeked={() => {
            const video = videoRef.current;
            if (!video || ignoreSeek.current || !generation) return;
            const rendition = profileRef.current === "auto" ? renditionRef.current : profileRef.current;
            void commitRef.current(rendition, video.currentTime);
          }}
          onWaiting={() => {
            if (stepUpTimer.current != null) {
              window.clearTimeout(stepUpTimer.current);
              stepUpTimer.current = null;
            }
            stableSince.current = null;
            if (profileRef.current !== "auto") {
              setHint("Still buffering on this quality. Switch to Auto if you want one step down. This choice stays until you change it.");
              return;
            }
            if (waitingTimer.current != null) return;
            const started = Date.now();
            waitingTimer.current = window.setTimeout(() => {
              waitingTimer.current = null;
              const video = videoRef.current;
              if (!video) return;
              const elapsed = Date.now() - started;
              if (!bufferTroubleSustained(elapsed, video.readyState)) return;
              const next = stepDown(renditionRef.current, ladderNow());
              if (!next) {
                setHint("Auto is already on the lowest rendition. Waiting for verified pieces.");
                return;
              }
              lastChangeAt.current = Date.now();
              stableSince.current = null;
              renditionRef.current = next;
              setAutoRendition(next);
              setHint(`Auto stepped down to ${next} after the buffer stayed in trouble. It will not step up until playback holds.`);
              void commitRef.current(next, keptPosition(video.currentTime, manifestRef.current?.position ?? 0));
            }, SUSTAINED_BUFFER_MS);
          }}
          onPlaying={() => {
            clearBufferTimers();
            if (profileRef.current !== "auto") return;
            if (stableSince.current == null) stableSince.current = Date.now();
            scheduleStepUp();
          }}
        />

        <div className="flex flex-wrap gap-2" role="group" aria-label="Quality">
          {offered.map((item) => (
            <Button key={item.id} variant={profile === item.id ? "default" : "ghost"} onClick={() => choose(item.id)}>
              {buttonLabel(item.id, item.bitrate)}
            </Button>
          ))}
        </div>
        {hint ? <p className="text-sm text-[var(--muted)]">{hint}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <p className="text-xs text-[var(--muted)]">{ABR_NOTE}</p>
      </div>
    </Shell>
  );
}
