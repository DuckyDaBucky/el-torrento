import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  acceptInvite,
  bootstrapOwner,
  getOwner,
  loginExisting,
} from "@/src/lib/db";
import { sessionSetCookie } from "@/src/lib/http";
import type { Identity } from "@/src/lib/access";

export async function GET(req: Request) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const user = await currentUser();
  const primary = user?.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  const identity: Identity = {
    clerkUserId: userId,
    email: primary?.emailAddress ?? "",
    emailVerified: primary?.verification?.status === "verified",
  };

  const inviteCode = new URL(req.url).searchParams.get("invite") ?? "";
  const existing = loginExisting(identity);
  const result = existing.ok
    ? existing
    : getOwner()
      ? acceptInvite(identity, inviteCode)
      : bootstrapOwner(identity);

  if (!result.ok) {
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(result.error)}`, req.url));
  }

  const dest = result.user.role === "owner" ? "/admin" : "/";
  const response = NextResponse.redirect(new URL(dest, req.url));
  response.headers.set("Set-Cookie", sessionSetCookie(result.sessionId));
  if (result.recoveryCode) {
    response.cookies.set("et_recovery_hint", "1", { httpOnly: false, path: "/", maxAge: 120 });
  }
  return response;
}
