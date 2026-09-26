export function readSessionId(req: Request): string | undefined {
  const cookie = req.headers.get("cookie") ?? "";
  const part = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("et_session="));
  if (!part) return undefined;
  return decodeURIComponent(part.slice("et_session=".length));
}

export function sessionSetCookie(sessionId: string): string {
  return `et_session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`;
}

export function sessionClearCookie(): string {
  return "et_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}
