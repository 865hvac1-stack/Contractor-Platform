import type { NextConfig } from "next";

function hostFromAppUrl(): string | null {
  const raw = process.env.APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

const allowedOrigins = [
  hostFromAppUrl(),
  "localhost:43123",
  "127.0.0.1:43123",
].filter((value): value is string => Boolean(value));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["xlsx"],
  // Bumps the Next/webpack config hash so Railway's mounted .next/cache
  // cannot reuse the poisoned css-loader build from the failed deploys.
  env: {
    CY_CONNECT_ARCH: "accounts-v2-saas",
  },
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins, "*.up.railway.app", "*.railway.app"],
      bodySizeLimit: "22mb",
    },
  },
};

export default nextConfig;
