import { NextResponse } from "next/server";
import { assertOwner, listAudit, readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { collectLiveNodes } from "@/src/lib/cluster";
import { listMedia, listRequests } from "@/src/lib/media";
import { getDb } from "@/src/lib/db";

const TOOLS = [
  "cluster_status",
  "guests",
  "services",
  "health",
  "active_streams",
  "media_requests",
  "recent_errors",
] as const;

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  return NextResponse.json({ tools: TOOLS, note: "Read-only. Apply and shell tools are not exposed." });
}

export async function POST(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { tool?: string };
  if (!body.tool || !TOOLS.includes(body.tool as (typeof TOOLS)[number])) {
    return NextResponse.json({ error: "Unknown tool." }, { status: 404 });
  }
  if (body.tool === "cluster_status") {
    return NextResponse.json(await collectLiveNodes());
  }
  if (body.tool === "guests") {
    return NextResponse.json({
      note: "Guest power is a separate allowlisted API, not an MCP tool.",
    });
  }
  if (body.tool === "services" || body.tool === "health") {
    return NextResponse.json({
      deploymentAgent: process.env.DEPLOY_AGENT_URL ? "configured" : "not configured",
      managementWorker: process.env.MGMT_WORKER_URL ? "configured" : "not configured",
      jellyfin: process.env.JELLYFIN_URL ? "configured" : "not configured",
    });
  }
  if (body.tool === "active_streams") {
    const rows = getDb()
      .prepare("SELECT user_id, media_id, profile, generation FROM playback")
      .all();
    return NextResponse.json({ streams: rows });
  }
  if (body.tool === "media_requests") {
    return NextResponse.json({ requests: listRequests(), media: listMedia() });
  }
  return NextResponse.json({ errors: listAudit(10).filter((row) => row.result !== "ok") });
}
