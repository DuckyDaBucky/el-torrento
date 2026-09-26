import type { Metadata } from "next";
import "./globals.css";
import { ClerkShell } from "@/components/clerk-shell";

export const metadata: Metadata = {
  title: "El Torrento",
  description: "Family player and homelab admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ClerkShell>{children}</ClerkShell>
      </body>
    </html>
  );
}
