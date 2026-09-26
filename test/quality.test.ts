import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProfileAllowed, deliveryBadge, offeredProfiles, type SourceFacts } from "../src/lib/quality";

const baseSource: SourceFacts = {
  height: 1080,
  hdr: "HDR10",
  audio: "EAC3 5.1",
  deliveryConfirmed: true,
  encoder2160: false,
  allow4k: false,
};

describe("offeredProfiles", () => {
  it("hides 2160p without encoder path and allow4k", () => {
    const profiles = offeredProfiles({ ...baseSource, height: 2160, encoder2160: true, allow4k: false });
    assert.ok(!profiles.some((item) => item.id === "2160p"));
  });

  it("offers 2160p when encoder and allow4k are true", () => {
    const profiles = offeredProfiles({ ...baseSource, height: 2160, encoder2160: true, allow4k: true });
    assert.ok(profiles.some((item) => item.id === "2160p"));
  });
});

describe("deliveryBadge", () => {
  it("marks unconfirmed original delivery honestly", () => {
    const badge = deliveryBadge({ ...baseSource, deliveryConfirmed: false }, "original");
    assert.equal(badge.showSuccess, false);
    assert.match(badge.label, /not confirmed/i);
  });

  it("describes transcode path for ladder profiles", () => {
    const badge = deliveryBadge(baseSource, "720p");
    assert.match(badge.label, /transcode/i);
  });
});

describe("assertProfileAllowed", () => {
  it("throws when profile is not offered", () => {
    assert.throws(() => assertProfileAllowed(baseSource, "2160p"), /not offered/i);
  });

  it("allows 2160p when encoder path and allow4k are satisfied", () => {
    const source: SourceFacts = {
      ...baseSource,
      height: 2160,
      encoder2160: true,
      allow4k: true,
    };
    assert.doesNotThrow(() => assertProfileAllowed(source, "2160p"));
    const badge = deliveryBadge(source, "2160p");
    assert.match(badge.label, /transcode/i);
  });

  it("gates 2160p when allow4k is false even with encoder path", () => {
    const source: SourceFacts = {
      ...baseSource,
      height: 2160,
      encoder2160: true,
      allow4k: false,
    };
    assert.throws(() => assertProfileAllowed(source, "2160p"), /not offered/i);
  });
});
