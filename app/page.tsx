"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LocalMedia = {
  id: string;
  title: string;
  height: number;
  hdr: string | null;
  audio_codec: string;
  request_state: string;
};

type CatalogCard = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
  playable: boolean;
  discoverable: boolean;
  mediaId: string | null;
  requestState: string | null;
};

type JellyfinItem = {
  id: string;
  title: string;
  year: string | null;
  type: string;
  imageUrl: string | null;
  playUrl: string | null;
};

function requestLabel(state: string | null): string | null {
  if (!state) return null;
  if (state === "available") return "Ready";
  if (state === "requested" || state === "resolving") return "Requested";
  if (state === "failed") return "Unavailable";
  return state.replace(/_/g, " ");
}

export default function WatchHome() {
  const [signedIn, setSignedIn] = useState(false);
  const [library, setLibrary] = useState<LocalMedia[]>([]);
  const [catalog, setCatalog] = useState<CatalogCard[]>([]);
  const [jellyfin, setJellyfin] = useState<{ items: JellyfinItem[]; limitation?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [message, setMessage] = useState("");
  const [requesting, setRequesting] = useState<string | null>(null);

  const loadCatalog = useCallback(async (q: string) => {
    setLoadingCatalog(true);
    setCatalogError("");
    const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
    const data = await res.json();
    setLoadingCatalog(false);
    if (!res.ok) {
      setCatalogError(data.error ?? "Could not load the catalog.");
      setCatalog([]);
      return;
    }
    setCatalog(data.results ?? []);
  }, []);

  async function load() {
    const auth = await fetch("/api/auth", { credentials: "include" }).then((res) => res.json());
    setSignedIn(Boolean(auth.user));
    if (!auth.user) return;
    const res = await fetch("/api/media", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    const ready = (data.media ?? []).filter((item: LocalMedia) => item.request_state === "available");
    setLibrary(ready);
    await loadCatalog("");
    const jf = await fetch("/api/catalog/jellyfin", { credentials: "include" }).then((r) => r.json());
    if (jf.items?.length) setJellyfin({ items: jf.items, limitation: jf.limitation });
  }

  useEffect(() => {
    load().catch(() => setCatalogError("Could not load the library."));
  }, [loadCatalog]);

  async function requestTitle(card: CatalogCard) {
    setMessage("");
    setRequesting(`${card.mediaType}-${card.id}`);
    const res = await fetch("/api/media", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: card.title,
        tmdbId: String(card.id),
        mediaType: card.mediaType,
      }),
    });
    const data = await res.json();
    setRequesting(null);
    if (!res.ok) {
      setMessage(data.error ?? "Could not request that title.");
      return;
    }
    setMessage(
      data.seerr?.ok
        ? `"${card.title}" was sent to the household request list.`
        : `"${card.title}" was saved. The request desk will pick it up when connected.`,
    );
    await loadCatalog(query);
  }

  const readyIds = new Set(library.map((item) => item.id));

  return (
    <Shell tone="watch">
      <section className="mb-10 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--sand)]">Family watch</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-6xl">Pick something tonight</h1>
        <p className="mt-4 max-w-xl text-[var(--muted)]">
          Browse posters, search by name, watch what is already on the shelf, or request a new title for the household.
        </p>
      </section>

      {!signedIn ? (
        <Link href="/sign-in">
          <Button>Sign in to watch</Button>
        </Link>
      ) : (
        <div className="space-y-12">
          <form
            className="flex max-w-xl flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(searchInput.trim());
              loadCatalog(searchInput.trim()).catch(() => setCatalogError("Search failed."));
            }}
          >
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search movies and shows"
            />
            <Button type="submit" disabled={loadingCatalog}>{loadingCatalog ? "Searching…" : "Search"}</Button>
          </form>

          {library.length > 0 ? (
            <section>
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 className="text-2xl font-medium">Ready to watch</h2>
                <p className="text-sm text-[var(--muted)]">Starts in this player</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {library.map((item) => (
                  <Link
                    key={item.id}
                    href={`/watch/${item.id}`}
                    className="group overflow-hidden rounded-xl border border-white/10 bg-[var(--card)] transition hover:border-[var(--sand)]/40"
                  >
                    <div className="relative flex aspect-[2/3] items-end bg-[radial-gradient(circle_at_30%_20%,#e4b07a,transparent_40%),linear-gradient(160deg,#1b2430,#0c0d10)] p-4">
                      <div>
                        <p className="text-lg font-medium leading-snug">{item.title}</p>
                        <p className="mt-1 text-xs text-white/70">
                          {item.height}p · {item.hdr ?? "SDR"} · {item.audio_codec}
                        </p>
                      </div>
                      <span className="absolute right-3 top-3 rounded-full bg-[var(--sand)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black">
                        Watch
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-2xl font-medium">{query ? `Results for “${query}”` : "Discover"}</h2>
              <p className="text-sm text-[var(--muted)]">Posters from TMDB</p>
            </div>
            {catalogError ? <p className="text-sm text-amber-200">{catalogError}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {catalog
                .filter((card) => !card.mediaId || !readyIds.has(card.mediaId))
                .map((card) => {
                  const pending = requestLabel(card.requestState);
                  return (
                    <article
                      key={`${card.mediaType}-${card.id}`}
                      className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[var(--card)]"
                    >
                      <div className="relative aspect-[2/3] bg-[#0c0d10]">
                        {card.posterUrl ? (
                          <Image
                            src={card.posterUrl}
                            alt=""
                            fill
                            sizes="(max-width: 768px) 50vw, 16vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-[var(--muted)]">
                            {card.title}
                          </div>
                        )}
                        {card.playable && card.mediaId ? (
                          <span className="absolute left-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium uppercase text-black">
                            On shelf
                          </span>
                        ) : pending ? (
                          <span className="absolute left-2 top-2 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase">
                            {pending}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-3">
                        <div>
                          <h3 className="text-sm font-medium leading-snug">{card.title}</h3>
                          <p className="text-xs text-[var(--muted)]">
                            {card.year ?? "—"} · {card.mediaType === "tv" ? "Series" : "Movie"}
                          </p>
                        </div>
                        {card.overview ? (
                          <p className="line-clamp-3 text-xs text-[var(--muted)]">{card.overview}</p>
                        ) : null}
                        <div className="mt-auto flex gap-2 pt-2">
                          {card.playable && card.mediaId ? (
                            <Link href={`/watch/${card.mediaId}`} className="flex-1">
                              <Button className="w-full py-1.5 text-xs">Watch</Button>
                            </Link>
                          ) : pending ? (
                            <Button className="w-full flex-1 py-1.5 text-xs" variant="ghost" disabled>
                              Requested
                            </Button>
                          ) : (
                            <Button
                              className="w-full flex-1 py-1.5 text-xs"
                              variant="ghost"
                              disabled={requesting === `${card.mediaType}-${card.id}`}
                              onClick={() => requestTitle(card)}
                            >
                              {requesting === `${card.mediaType}-${card.id}` ? "Sending…" : "Request"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
            </div>
            {!loadingCatalog && catalog.length === 0 && !catalogError ? (
              <p className="text-[var(--muted)]">No titles to show yet. Try another search.</p>
            ) : null}
          </section>

          {jellyfin?.items.length ? (
            <section>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-2xl font-medium">Household library</h2>
                <a
                  href="https://media.hasnain.us"
                  className="text-sm text-[var(--sand)] underline-offset-4 hover:underline"
                >
                  Open Jellyfin
                </a>
              </div>
              {jellyfin.limitation ? (
                <p className="mb-4 max-w-2xl text-sm text-[var(--muted)]">{jellyfin.limitation}</p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
                {jellyfin.items.map((item) => (
                  <a
                    key={item.id}
                    href={item.playUrl ?? "https://media.hasnain.us"}
                    target="_blank"
                    rel="noreferrer"
                    className="overflow-hidden rounded-xl border border-white/10 bg-[var(--card)] transition hover:border-white/25"
                  >
                    <div className="relative aspect-[2/3] bg-[#0c0d10]">
                      {item.imageUrl ? (
                        // Jellyfin images are same-origin to the server URL; use img for flexibility.
                        <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-3 text-center text-xs text-[var(--muted)]">
                          {item.title}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="text-xs text-[var(--muted)]">{item.year ?? "—"} · {item.type}</p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {message ? <p className="text-sm text-[var(--sand)]">{message}</p> : null}
        </div>
      )}
    </Shell>
  );
}
