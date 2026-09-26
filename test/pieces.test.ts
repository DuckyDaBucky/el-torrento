import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availableByteLength, pieceCount, resolveRange } from "../src/lib/pieces";

describe("piece map", () => {
  it("computes piece count from file size", () => {
    assert.equal(pieceCount(1_000_000, 256_000), 4);
  });

  it("caps available bytes at verified prefix", () => {
    assert.equal(availableByteLength(1_000_000, 256_000, 2), 512_000);
  });

  it("refuses range beyond verified pieces", () => {
    const result = resolveRange({
      fileSize: 1_000_000,
      pieceSize: 256_000,
      availablePieces: 2,
      header: "bytes=600000-999999",
      generation: 1,
      requestedGeneration: 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 416);
      assert.match(result.message, /not downloaded/i);
    }
  });

  it("rejects stale generation", () => {
    const result = resolveRange({
      fileSize: 1_000_000,
      pieceSize: 256_000,
      availablePieces: 4,
      header: null,
      generation: 2,
      requestedGeneration: 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });
});
