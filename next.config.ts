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
};

export default nextConfig;
