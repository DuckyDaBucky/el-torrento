import { NextResponse } from "next/server";
import { readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { listJellyfinLibrary } from "@/src/lib/services";

/**
 * Lists recent Jellyfin library titles when the server is configured.
 * Watch Now progressive playback stays on El Torrento; Jellyfin links open the family library UI.
 */
export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const jellyfin = await listJellyfinLibrary({
    baseUrl: process.env.JELLYFIN_URL,
    apiKey: process.env.JELLYFIN_API_KEY,
    publicBaseUrl: process.env.JELLYFIN_PUBLIC_URL,
  });
  if (!jellyfin.ok) {
    return NextResponse.json(
      { configured: Boolean(process.env.JELLYFIN_URL && process.env.JELLYFIN_API_KEY), error: jellyfin.error, items: [] },
      { status: jellyfin.error === "Jellyfin is not configured." ? 200 : 503 },
    );
  }
  return NextResponse.json({
    configured: true,
    limitation:
      "Titles here open Jellyfin for direct play. Progressive Watch Now playback is only available for titles in your El Torrento library.",
    items: jellyfin.items,
  });
}
