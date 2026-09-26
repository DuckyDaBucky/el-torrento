import { NextResponse } from "next/server";
import { assertOwner, readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { listIndexerSources, prowlarrStatus, setIndexerSource } from "@/src/lib/sources";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  const prowlarr = await prowlarrStatus({
    baseUrl: process.env.PROWLARR_URL ?? "http://prowlarr:9696",
    apiKey: process.env.PROWLARR_API_KEY,
  });
  return NextResponse.json({ sources: listIndexerSources(), prowlarr });
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
    enabled?: boolean;
    tested?: boolean;
  };
  try {
    if (body.action === "patch" && body.id) {
      const source = setIndexerSource(user, body.id, { enabled: body.enabled, tested: body.tested });
      return NextResponse.json({ source, sources: listIndexerSources() });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update refused." },
      { status: 400 },
    );
  }
}
