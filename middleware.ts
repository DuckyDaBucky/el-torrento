import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/api/auth(.*)", "/api/auth/clerk-sync"]);

export default clerkMiddleware(async (auth, req) => {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.next();
  }
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }
  if (isAdminRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
