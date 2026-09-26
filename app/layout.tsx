import type { Metadata } from "next";
import { ClerkShell } from "@/components/clerk-shell";
import "./globals.css";

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
