import { NextResponse } from "next/server";
import { assertOwner, createInvite, listUsers, readSession, setUserStatus, updateQuotas } from "@/src/lib/db";
import { readSessionId } from "@/src/lib/http";
import { syncJellyfin, syncSeerr } from "@/src/lib/services";

function actor(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return null;
  return user;
}

export async function GET(req: Request) {
  const user = actor(req);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: Request) {
  const user = actor(req);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    assertOwner(user);
  } catch {
    return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    email?: string;
    userId?: string;
    status?: "active" | "suspended" | "revoked";
    requestQuota?: number;
    streamQuota?: number;
    remoteBitrateKbps?: number;
    allow4k?: boolean;
  };

  try {
    if (body.action === "invite") {
      const invite = createInvite(user, body.email ?? "");
      return NextResponse.json({ invite });
    }
    if (body.action === "status" && body.userId && body.status) {
      setUserStatus(user, body.userId, body.status);
      if (body.status === "suspended" || body.status === "revoked") {
        const target = listUsers().find((item) => item.id === body.userId);
        if (target) {
          await syncJellyfin({
            user: { ...user, id: target.id, email: target.email, status: body.status, role: "viewer" },
            baseUrl: process.env.JELLYFIN_URL,
            apiKey: process.env.JELLYFIN_API_KEY,
          });
        }
      }
      return NextResponse.json({ ok: true, users: listUsers() });
    }
    if (body.action === "quotas" && body.userId) {
      updateQuotas(user, body.userId, {
        requestQuota: Number(body.requestQuota ?? 5),
        streamQuota: Number(body.streamQuota ?? 2),
        remoteBitrateKbps: Number(body.remoteBitrateKbps ?? 4000),
        allow4k: Boolean(body.allow4k),
      });
      return NextResponse.json({ ok: true, users: listUsers() });
    }
    if (body.action === "sync" && body.userId) {
      const target = listUsers().find((item) => item.id === body.userId);
      if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
      const record = {
        id: target.id,
        email: target.email,
        role: target.role,
        status: target.status,
        clerk_user_id: "",
        recovery_hash: null,
        created_at: "",
        request_quota: target.requestQuota,
        stream_quota: target.streamQuota,
        remote_bitrate_kbps: target.remoteBitrateKbps,
        allow_4k: target.allow4k ? 1 : 0,
      };
      const jellyfin = await syncJellyfin({
        user: record,
        baseUrl: process.env.JELLYFIN_URL,
        apiKey: process.env.JELLYFIN_API_KEY,
      });
      const seerr = await syncSeerr({
        user: record,
        baseUrl: process.env.SEERR_URL,
        apiKey: process.env.SEERR_API_KEY,
      });
      return NextResponse.json({ jellyfin, seerr, users: listUsers() });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 400 },
    );
  }
}
