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
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins, "*.up.railway.app", "*.railway.app"],
    },
  },
};

export default nextConfig;
