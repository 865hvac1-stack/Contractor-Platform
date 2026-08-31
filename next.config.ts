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
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins, "*.up.railway.app", "*.railway.app"],
      bodySizeLimit: "22mb",
    },
  },
  // Railway mounts a persistent Next/webpack cache. A stale cache has failed
  // production image builds in css-loader/neo-async ("Callback was already called").
  webpack: (config, { dev }) => {
    if (!dev) config.cache = false;
    return config;
  },
};

export default nextConfig;
