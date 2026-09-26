export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.ELTORRENTO_ROLE === "watch") return;
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
    throw new Error(
      "Production refuses to start without Clerk keys. Set CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY.",
    );
  }
}
