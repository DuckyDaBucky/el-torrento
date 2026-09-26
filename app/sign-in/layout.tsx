import { Suspense } from "react";

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="p-8 text-sm text-[var(--muted)]">Loading sign-in…</p>}>{children}</Suspense>;
}
