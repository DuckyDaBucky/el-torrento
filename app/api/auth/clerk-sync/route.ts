import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  acceptInvite,
  bootstrapOwner,
  getOwner,
  getUserByClerkId,
  loginExisting,
  type AuthResult,
} from "@/src/lib/db";
import { sessionSetCookie } from "@/src/lib/http";
import type { Identity } from "@/src/lib/access";

function identityFromUser(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>): Identity {
  const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  return {
    clerkUserId: user.id,
    email: primary?.emailAddress ?? "",
    emailVerified: primary?.verification?.status === "verified",
  };
}

function resolveAuth(identity: Identity, inviteCode?: string): AuthResult {
  const existing = getUserByClerkId(identity.clerkUserId);
  if (existing) return loginExisting(identity);
  if (getOwner()) {
    if (inviteCode) return acceptInvite(identity, inviteCode);
    return { ok: false, status: 403, error: "No account is bound to this id." };
  }
  return bootstrapOwner(identity);
}

async function syncFromClerk(req: Request, inviteCode?: string) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Clerk session was not accepted." }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Clerk user record is missing." }, { status: 401 });
  }
  const identity = identityFromUser(user);
  const result = resolveAuth(identity, inviteCode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const redirect =
    new URL(req.url).searchParams.get("redirect") ??
    (result.user.role === "owner" ? "/admin" : "/");
  const response = NextResponse.redirect(new URL(redirect, req.url));
  response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
  return response;
}

export async function GET(req: Request) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "Clerk is not configured." }, { status: 503 });
  }
  return syncFromClerk(req);
}

export async function POST(req: Request) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "Clerk is not configured." }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { inviteCode?: string };
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Clerk session was not accepted." }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Clerk user record is missing." }, { status: 401 });
  }
  const identity = identityFromUser(user);
  const result = resolveAuth(identity, body.inviteCode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const response = NextResponse.json({
    user: { id: result.user.id, email: result.user.email, role: result.user.role, status: result.user.status },
    recoveryCode: result.recoveryCode ?? null,
  });
  response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
  return response;
}
