"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

export function ClerkShell({ children }: { children: ReactNode }) {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!pk) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={pk}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      afterSignInUrl="/api/auth/clerk-sync"
      afterSignUpUrl="/api/auth/clerk-sync"
    >
      {children}
    </ClerkProvider>
  );
}
