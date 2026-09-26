import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byteForTime, keptPosition, pieceCount, piecesCovering, resolveRange } from "../src/lib/pieces";

describe("piece map", () => {
  it("computes piece count from file size", () => {
    assert.equal(pieceCount(1_000_000, 256_000), 4);
  });

  it("lists pieces that overlap an in-file range", () => {
    assert.deepEqual(piecesCovering(600_000, 900_000, 256_000, 1_000_000), [2, 3]);
  });

  it("treats an in-file range as satisfiable even when pieces are missing", () => {
    const result = resolveRange({
      fileSize: 1_000_000,
      header: "bytes=600000-999999",
      generation: 1,
      requestedGeneration: 1,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.start, 600_000);
      assert.equal(result.end, 999_999);
    }
  });

  it("returns 416 only when the range misses the file", () => {
    const result = resolveRange({
      fileSize: 1_000_000,
      header: "bytes=1000000-1000100",
      generation: 1,
      requestedGeneration: 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 416);
      assert.match(result.message, /outside the file/i);
    }
  });

  it("rejects stale generation", () => {
    const result = resolveRange({
      fileSize: 1_000_000,
      header: null,
      generation: 2,
      requestedGeneration: 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });

  it("keeps a playhead across quality changes", () => {
    assert.equal(keptPosition(42.5, 10), 42.5);
    assert.equal(keptPosition(0, 10), 10);
    assert.equal(keptPosition(Number.NaN, 0), 0);
  });

  it("maps a timestamp into the file", () => {
    assert.equal(byteForTime(1000, 10, 2.5), 250);
  });
});
