import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  eslint: {
    // Keep builds unblocked during iterative development; re-enable before shipping.
    ignoreDuringBuilds: true,
  },
  // Prisma's client isn't meant to be bundled by webpack/turbopack for
  // server code — without this, API routes under src/app/api/connectors/*
  // can fail to build or throw at runtime ("PrismaClient is unable to run
  // in this browser environment" or native binary resolution errors).
  serverExternalPackages: ["@prisma/client", "@prisma/engines"],
};

export default nextConfig;
