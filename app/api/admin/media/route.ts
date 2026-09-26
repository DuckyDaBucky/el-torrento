import { NextResponse } from "next/server";
import { assertOwner, readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { addTorrent, listMedia, listRequests, setRequestState } from "@/src/lib/media";
import { resolveDownloadDir } from "@/src/lib/storage-guard";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  return NextResponse.json({ media: listMedia(), requests: listRequests() });
}

export async function POST(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    state?: string;
    nfsMounted?: boolean;
    title?: string;
    torrentPath?: string;
    savePath?: string;
    peer?: string;
    height?: number;
    durationSec?: number;
    priorities?: number[];
  };
  try {
    if (body.action === "state" && body.id && body.state) {
      setRequestState(user, body.id, body.state);
      return NextResponse.json({ ok: true, requests: listRequests() });
    }
    if (body.action === "add-torrent" && body.title && body.torrentPath && body.savePath) {
      const row = await addTorrent(user, {
        id: body.id,
        title: body.title,
        torrentPath: body.torrentPath,
        savePath: body.savePath,
        peer: body.peer,
        height: body.height,
        durationSec: body.durationSec,
        priorities: body.priorities,
      });
      return NextResponse.json({ ok: true, media: row });
    }
    if (body.action === "download-path") {
      const dir = resolveDownloadDir(Boolean(body.nfsMounted), "/mnt/downloads");
      return NextResponse.json({
        ok: true,
        dir,
        note: "Missing NFS does not fall back to the VM disk.",
      });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refused." },
      { status: 409 },
    );
  }
}
