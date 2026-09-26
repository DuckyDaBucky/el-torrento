import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABR_NOTE,
  AUTO_STEP_UP_COOLDOWN_MS,
  autoLadder,
  bufferTroubleSustained,
  canStepUp,
  formatLossSentence,
  playingLabel,
  readStoredManualQuality,
  resolveInitialQuality,
  stepDown,
  stepUp,
  SUSTAINED_BUFFER_MS,
  transcodeLosses,
  visibleProfiles,
  writeStoredManualQuality,
  MANUAL_QUALITY_KEY,
} from "../components/player";

const offered = ["auto", "original", "2160p", "1080p", "720p", "480p"];

describe("player quality policy", () => {
  it("offers only renditions the source can supply and never upscales", () => {
    const visible = visibleProfiles(
      offered.map((id) => ({ id, bitrate: id === "720p" ? "4000k" : undefined })),
      { height: 1080, encoder2160: true, allow4k: true },
    ).map((item) => item.id);
    assert.deepEqual(visible, ["auto", "original", "1080p", "720p", "480p"]);
    assert.equal(visible.includes("2160p"), false);
  });

  it("hides 2160p unless the encoder path and 4K policy both allow it", () => {
    const visible = visibleProfiles(
      offered.map((id) => ({ id })),
      { height: 2160, encoder2160: false, allow4k: true },
    ).map((item) => item.id);
    assert.equal(visible.includes("2160p"), false);
  });

  it("steps auto down one playable rendition and skips software 4K", () => {
    const ladder = autoLadder(offered, 2160);
    assert.deepEqual(ladder, ["original", "1080p", "720p", "480p"]);
    assert.equal(stepDown("original", ladder), "1080p");
    assert.equal(stepDown("1080p", ladder), "720p");
    assert.equal(stepDown("480p", ladder), null);
    assert.equal(stepUp("720p", ladder), "1080p");
    assert.equal(stepUp("original", ladder), null);
  });

  it("treats buffer trouble as sustained and steps up only after the cooldown", () => {
    assert.equal(bufferTroubleSustained(SUSTAINED_BUFFER_MS - 1, 1), false);
    assert.equal(bufferTroubleSustained(SUSTAINED_BUFFER_MS, 2), true);
    assert.equal(bufferTroubleSustained(SUSTAINED_BUFFER_MS, 3), false);
    const start = 10_000;
    assert.equal(canStepUp(start + AUTO_STEP_UP_COOLDOWN_MS - 1, start, start), false);
    assert.equal(canStepUp(start + AUTO_STEP_UP_COOLDOWN_MS, 0, start), true);
    assert.equal(canStepUp(start + AUTO_STEP_UP_COOLDOWN_MS, start, null), false);
  });

  it("remembers a manual quality per device and ignores one the source cannot play", () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
      removeItem: (key: string) => {
        saved.delete(key);
      },
    };
    writeStoredManualQuality(storage, "720p");
    assert.equal(saved.get(MANUAL_QUALITY_KEY), "720p");
    assert.equal(readStoredManualQuality(storage), "720p");
    const kept = resolveInitialQuality({ stored: "720p", offeredIds: offered, sourceHeight: 1080 });
    assert.equal(kept.profile, "720p");
    const rejected = resolveInitialQuality({ stored: "2160p", offeredIds: ["auto", "original", "720p"], sourceHeight: 720 });
    assert.equal(rejected.profile, "auto");
    assert.equal(rejected.rendition, "original");
    writeStoredManualQuality(storage, "auto");
    assert.equal(readStoredManualQuality(storage), null);
  });

  it("names HDR, Dolby Vision, lossless audio, and Atmos when a transcode drops them", () => {
    const losses = transcodeLosses("Dolby Vision HDR10", "TrueHD Atmos");
    assert.deepEqual(losses, ["Dolby Vision", "HDR", "Atmos", "lossless audio"]);
    assert.match(formatLossSentence(losses), /Dolby Vision/);
    assert.match(formatLossSentence(losses), /Atmos/);
    assert.match(formatLossSentence(["lossless audio"]), /drops lossless audio/);
    const label = playingLabel({
      rendition: "720p",
      bitrate: "4000k",
      hdr: "Dolby Vision",
      audio: "TrueHD Atmos",
      deliveryConfirmed: true,
    });
    assert.match(label.label, /Playing 720p transcode/);
    assert.match(label.label, /target 4000k/);
    assert.match(label.detail, /Dolby Vision/);
    assert.match(label.detail, /Atmos/);
    assert.match(label.detail, /lossless audio/);
    assert.match(ABR_NOTE, /not a seamless/i);
    assert.match(label.detail, /not a seamless/i);
  });

  it("does not claim a confirmed HDR path for an unverified original", () => {
    const label = playingLabel({
      rendition: "original",
      hdr: "HDR10",
      audio: "EAC3 Atmos",
      deliveryConfirmed: false,
    });
    assert.match(label.label, /not confirmed/i);
    assert.equal(label.label.includes("Playing original · HDR10"), false);
  });
});
