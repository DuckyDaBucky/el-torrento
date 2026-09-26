"use client";

import { SignIn } from "@clerk/nextjs";

export function ClerkSignIn() {
  return (
    <div className="flex justify-center">
      <SignIn routing="hash" signUpUrl="/sign-in" />
    </div>
  );
}
