import { verifyToken, createClerkClient } from "@clerk/backend";
import type { Identity } from "./access";

export async function identityFromClerk(req: Request): Promise<Identity | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return null;
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const cookie = req.headers.get("cookie") ?? "";
  const sessionCookie = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("__session="))
    ?.slice("__session=".length);
  const token = bearer || sessionCookie;
  if (!token) return null;
  const payload = await verifyToken(token, { secretKey: secret });
  const userId = payload.sub;
  if (!userId) return null;
  const clerk = createClerkClient({ secretKey: secret });
  const user = await clerk.users.getUser(userId);
  const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  return {
    clerkUserId: userId,
    email: primary?.emailAddress ?? "",
    emailVerified: primary?.verification?.status === "verified",
  };
}
