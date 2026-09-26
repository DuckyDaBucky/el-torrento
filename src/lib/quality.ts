export const PROFILES = ["auto", "original", "2160p", "1080p", "720p", "480p"] as const;
export type ProfileId = (typeof PROFILES)[number];

const LADDER: { id: Exclude<ProfileId, "auto" | "original">; height: number; bitrate: string }[] = [
  { id: "2160p", height: 2160, bitrate: "16000k" },
  { id: "1080p", height: 1080, bitrate: "8000k" },
  { id: "720p", height: 720, bitrate: "4000k" },
  { id: "480p", height: 480, bitrate: "1500k" },
];

export type SourceFacts = {
  height: number;
  hdr: string | null;
  audio: string;
  deliveryConfirmed: boolean;
  encoder2160: boolean;
  allow4k: boolean;
};

export function offeredProfiles(source: SourceFacts): { id: ProfileId; bitrate?: string }[] {
  const offered: { id: ProfileId; bitrate?: string }[] = [
    { id: "auto" },
    { id: "original" },
  ];
  for (const step of LADDER) {
    if (source.height < step.height) continue;
    if (step.id === "2160p" && (!source.encoder2160 || !source.allow4k)) continue;
    offered.push({ id: step.id, bitrate: step.bitrate });
  }
  return offered;
}

export type DeliveryBadge = {
  showSuccess: boolean;
  label: string;
  detail: string;
};

export function deliveryBadge(source: SourceFacts, profile: ProfileId): DeliveryBadge {
  const chosen = profile === "auto" ? "original" : profile;
  if (chosen === "original") {
    if (!source.deliveryConfirmed) {
      return {
        showSuccess: false,
        label: "Path not confirmed",
        detail: "Original was requested. HDR and audio were not verified on this delivery.",
      };
    }
    const video = source.hdr ?? "SDR";
    return {
      showSuccess: true,
      label: `${video} · ${source.audio} · direct`,
      detail: "Playing the file as stored. Nothing was converted.",
    };
  }
  const dropped = [source.hdr, source.audio !== "AAC stereo" ? source.audio : null]
    .filter(Boolean)
    .join(", ");
  return {
    showSuccess: true,
    label: `SDR · AAC stereo · ${chosen} transcode`,
    detail: dropped
      ? `Converted. This path drops ${dropped}.`
      : "Converted to a smaller SDR picture.",
  };
}

export function assertProfileAllowed(source: SourceFacts, profile: ProfileId): void {
  if (profile === "auto") return;
  const ok = offeredProfiles(source).some((item) => item.id === profile);
  if (!ok) {
    throw new Error(
      profile === "2160p"
        ? "2160p is not offered for this title. The source is smaller, or the encoder path is not proven."
        : `${profile} is not offered for this title.`,
    );
  }
}
