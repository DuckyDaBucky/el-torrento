import { DevSignIn } from "@/components/dev-sign-in";
import { ClerkSignIn } from "@/components/clerk-sign-in";

export default function SignInPage() {
  if (process.env.CLERK_SECRET_KEY) {
    return <ClerkSignIn />;
  }
  return <DevSignIn />;
}
