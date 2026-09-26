import { NextResponse } from "next/server";
import { assertOwner, readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { collectLiveNodes, PREFLIGHT_SNAPSHOT } from "@/src/lib/cluster";
import { listAudit } from "@/src/lib/db";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  const live = await collectLiveNodes();
  return NextResponse.json({
    live,
    preflight: PREFLIGHT_SNAPSHOT,
    audit: listAudit(12),
  });
}
