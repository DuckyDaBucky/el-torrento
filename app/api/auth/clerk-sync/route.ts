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

function attachSession(response: NextResponse, result: AuthResult): NextResponse {
  if (!result.ok) return response;
  response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
  if (result.recoveryCode) {
    response.cookies.set("et_recovery_hint", "1", { httpOnly: false, path: "/", maxAge: 120 });
  }
  return response;
}

export async function GET(req: Request) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const inviteCode = new URL(req.url).searchParams.get("invite") ?? "";
  const identity = identityFromUser(user);
  const result = resolveAuth(identity, inviteCode);
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(result.error)}`, req.url));
  }
  const redirectParam = new URL(req.url).searchParams.get("redirect");
  const dest = redirectParam ?? (result.user.role === "owner" ? "/admin" : "/");
  const response = NextResponse.redirect(new URL(dest, req.url));
  return attachSession(response, result);
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
  return attachSession(response, result);
}
