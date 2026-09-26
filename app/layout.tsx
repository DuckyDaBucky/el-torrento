import type { Metadata } from "next";
import { AppClerkProvider } from "@/components/clerk-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "El Torrento",
  description: "Family player and homelab admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppClerkProvider>{children}</AppClerkProvider>
      </body>
    </html>
  );
}
