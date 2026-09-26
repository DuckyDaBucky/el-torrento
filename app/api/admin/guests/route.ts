import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertOwner, readSession } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { APPROVED_GUESTS, requestGuestAction } from "@/src/lib/mgmt";

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  return NextResponse.json({
    guests: APPROVED_GUESTS,
    workerConfigured: Boolean(process.env.MGMT_WORKER_URL),
  });
}

export async function POST(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { guest?: string; action?: string };
  const result = await requestGuestAction({
    actor: user,
    guest: body.guest ?? "",
    action: body.action ?? "",
    idempotencyKey: randomUUID(),
    workerUrl: process.env.MGMT_WORKER_URL,
  });
  return NextResponse.json(result, { status: result.status });
}
