import assert from "node:assert/strict";
import test from "node:test";
import { matchLocalMedia, normalizeTitle } from "../src/lib/catalog";
import type { MediaRow } from "../src/lib/media";

test("normalizeTitle strips punctuation", () => {
  assert.equal(normalizeTitle("Dune: Part Two"), "dune part two");
});

test("matchLocalMedia links TMDB hit to available row", () => {
  const library = [
    {
      id: "med_1",
      title: "Dune Part Two (2024)",
      request_state: "available",
    } as MediaRow,
  ];
  const hit = {
    id: 693134,
    mediaType: "movie" as const,
    title: "Dune: Part Two",
    year: "2024",
    posterPath: null,
    overview: null,
  };
  const match = matchLocalMedia(hit, library);
  assert.equal(match?.id, "med_1");
});
