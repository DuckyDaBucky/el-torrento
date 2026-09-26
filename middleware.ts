import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/api/auth(.*)", "/api/auth/clerk-sync"]);

export default clerkMiddleware(async (auth, req) => {
  const role = process.env.ELTORRENTO_ROLE?.trim().toLowerCase();
  if (role === "watch" && (req.nextUrl.pathname.startsWith("/admin") || req.nextUrl.pathname.startsWith("/api/admin"))) {
    return NextResponse.json({ error: "Admin is only on server.hasnain.us." }, { status: 404 });
  }
  if (role === "admin" && req.nextUrl.pathname.startsWith("/watch")) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.next();
  }

  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  if (!isAdminRoute(req)) {
    return NextResponse.next();
  }

  const { userId } = await auth();
  if (!userId) {
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  const session = req.cookies.get("et_session")?.value;
  if (!session) {
    const sync = new URL("/api/auth/clerk-sync", req.url);
    sync.searchParams.set("redirect", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(sync);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
