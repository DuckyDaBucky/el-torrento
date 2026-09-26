export type TmdbHit = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  posterPath: string | null;
  overview: string | null;
};

export function tmdbPosterUrl(posterPath: string | null, width = "w500"): string | null {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${width}${posterPath}`;
}

type RawMovie = { id: number; title?: string; release_date?: string; poster_path?: string | null; overview?: string };
type RawTv = { id: number; name?: string; first_air_date?: string; poster_path?: string | null; overview?: string };

function mapMovie(hit: RawMovie): TmdbHit | null {
  if (hit.id == null || !hit.title) return null;
  return {
    id: hit.id,
    mediaType: "movie",
    title: hit.title,
    year: hit.release_date?.slice(0, 4) ?? null,
    posterPath: hit.poster_path ?? null,
    overview: hit.overview ?? null,
  };
}

function mapTv(hit: RawTv): TmdbHit | null {
  if (hit.id == null || !hit.name) return null;
  return {
    id: hit.id,
    mediaType: "tv",
    title: hit.name,
    year: hit.first_air_date?.slice(0, 4) ?? null,
    posterPath: hit.poster_path ?? null,
    overview: hit.overview ?? null,
  };
}

export async function searchTmdb(input: {
  query: string;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; results: TmdbHit[]; error?: string }> {
  const q = input.query.trim();
  if (!q) return browseTmdb(input);
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
      const body = (await movies.json()) as { results?: RawMovie[] };
      for (const hit of body.results ?? []) {
        const mapped = mapMovie(hit);
        if (mapped) results.push(mapped);
      }
    }
    if (tv.ok) {
      const body = (await tv.json()) as { results?: RawTv[] };
      for (const hit of body.results ?? []) {
        const mapped = mapTv(hit);
        if (mapped) results.push(mapped);
      }
    }
    return { ok: true, results: results.slice(0, 24) };
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : "TMDB search failed." };
  }
}

/** Default home rows when no search query is provided. */
export async function browseTmdb(input: {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; results: TmdbHit[]; error?: string }> {
  if (!input.apiKey) return { ok: false, results: [], error: "TMDB is not configured." };
  const fetchImpl = input.fetchImpl ?? fetch;
  const root = "https://api.themoviedb.org/3";
  try {
    const [movies, tv] = await Promise.all([
      fetchImpl(`${root}/movie/popular?include_adult=false`, {
        headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      }),
      fetchImpl(`${root}/tv/popular?include_adult=false`, {
        headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      }),
    ]);
    const results: TmdbHit[] = [];
    if (movies.ok) {
      const body = (await movies.json()) as { results?: RawMovie[] };
      for (const hit of body.results ?? []) {
        const mapped = mapMovie(hit);
        if (mapped) results.push(mapped);
      }
    }
    if (tv.ok) {
      const body = (await tv.json()) as { results?: RawTv[] };
      for (const hit of body.results ?? []) {
        const mapped = mapTv(hit);
        if (mapped) results.push(mapped);
      }
    }
    return { ok: true, results: results.slice(0, 24) };
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : "TMDB browse failed." };
  }
}
