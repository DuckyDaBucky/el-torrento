import type { NextConfig } from "next";

const internalApi = process.env.INTERNAL_API_URL?.replace(/\/$/, "");
const watchRole = process.env.ELTORRENTO_ROLE === "watch";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@clerk/backend"],
  async rewrites() {
    if (!watchRole || !internalApi) return [];
    return [{ source: "/api/:path*", destination: `${internalApi}/api/:path*` }];
  },
};

export default nextConfig;
