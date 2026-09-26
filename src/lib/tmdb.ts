export type TmdbHit = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
};

export async function searchTmdb(input: {
  query: string;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; results: TmdbHit[]; error?: string }> {
  const q = input.query.trim();
  if (!q) return { ok: false, results: [], error: "Enter a title." };
  if (!input.apiKey) return { ok: false, results: [], error: "TMDB is not configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const root = "https://api.themoviedb.org/3";
  try {
    const [movies, tv] = await Promise.all([
      fetchImpl(`${root}/search/movie?query=${encodeURIComponent(q)}&include_adult=false`, {
        headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      }),
      fetchImpl(`${root}/search/tv?query=${encodeURIComponent(q)}&include_adult=false`, {
        headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      }),
    ]);
    const results: TmdbHit[] = [];
    if (movies.ok) {
      const body = (await movies.json()) as { results?: { id: number; title?: string; release_date?: string }[] };
      for (const hit of body.results ?? []) {
        if (hit.id == null || !hit.title) continue;
        results.push({
          id: hit.id,
          mediaType: "movie",
          title: hit.title,
          year: hit.release_date?.slice(0, 4) ?? null,
        });
      }
    }
    if (tv.ok) {
      const body = (await tv.json()) as { results?: { id: number; name?: string; first_air_date?: string }[] };
      for (const hit of body.results ?? []) {
        if (hit.id == null || !hit.name) continue;
        results.push({
          id: hit.id,
          mediaType: "tv",
          title: hit.name,
          year: hit.first_air_date?.slice(0, 4) ?? null,
        });
      }
    }
    return { ok: true, results: results.slice(0, 12) };
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : "TMDB search failed." };
  }
}
