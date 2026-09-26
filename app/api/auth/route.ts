import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  acceptInvite,
  bootstrapOwner,
  devAuthEnabled,
  getOwner,
  loginExisting,
  readSession,
  recoverOwner,
} from "@/src/lib/db";
import { identityFromClerk } from "@/src/lib/clerk";
import { readSessionId, sessionClearCookie, sessionSetCookie } from "@/src/lib/http";
import { BOOTSTRAP_OWNER_EMAIL } from "@/src/lib/access";

function publicUser(user: { id: string; email: string; role: string; status: string }) {
  return { id: user.id, email: user.email, role: user.role, status: user.status };
}

export async function GET(req: Request) {
  const user = readSession(readSessionId(req));
  return NextResponse.json({
    user: user ? publicUser(user) : null,
    clerk: Boolean(process.env.CLERK_SECRET_KEY),
    devAuth: devAuthEnabled(),
    ownerExists: Boolean(getOwner()),
    bootstrapEmail: BOOTSTRAP_OWNER_EMAIL,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    inviteCode?: string;
    email?: string;
    recoveryCode?: string;
  };

  if (body.action === "logout") {
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", sessionClearCookie());
    return response;
  }

  const clerkIdentity = process.env.CLERK_SECRET_KEY ? await identityFromClerk(req).catch(() => null) : null;

  if (body.action === "clerk") {
    if (!clerkIdentity) {
      return NextResponse.json({ error: "Clerk session was not accepted." }, { status: 401 });
    }
    const existing = loginExisting(clerkIdentity);
    const result = existing.ok ? existing : getOwner() ? acceptInvite(clerkIdentity, body.inviteCode ?? "") : bootstrapOwner(clerkIdentity);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const response = NextResponse.json({
      user: publicUser(result.user),
      recoveryCode: result.recoveryCode ?? null,
    });
    response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
    return response;
  }

  if (!devAuthEnabled()) {
    return NextResponse.json(
      { error: "Dev sign-in is off. Configure Clerk to sign in." },
      { status: 503 },
    );
  }

  if (body.action === "bootstrap") {
    const result = bootstrapOwner({
      clerkUserId: `dev_${randomBytes(16).toString("hex")}`,
      email: BOOTSTRAP_OWNER_EMAIL,
      emailVerified: true,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const response = NextResponse.json({
      user: publicUser(result.user),
      recoveryCode: result.recoveryCode,
    });
    response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
    return response;
  }

  if (body.action === "accept") {
    const email = (body.email ?? "").trim().toLowerCase();
    const result = acceptInvite(
      {
        clerkUserId: `dev_${randomBytes(16).toString("hex")}`,
        email,
        emailVerified: true,
      },
      body.inviteCode ?? "",
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const response = NextResponse.json({ user: publicUser(result.user) });
    response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
    return response;
  }

  if (body.action === "recover") {
    const result = recoverOwner(body.recoveryCode ?? "");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const response = NextResponse.json({
      user: publicUser(result.user),
      recoveryCode: result.recoveryCode,
    });
    response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
    return response;
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
