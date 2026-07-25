import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a second `next dev` process against this same checkout use its own
  // build cache directory instead of colliding with the default `.next` —
  // two concurrent dev servers writing to the same webpack pack-cache on
  // Windows causes ENOENT rename errors and intermittent 404s for hashed
  // static chunks. Unset (the default) behaves exactly as before.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
