import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { cpus: 1 },
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1600, 1920],
    imageSizes: [64, 96, 128, 256, 320, 384, 480],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/site-media/**",
      },
    ],
    formats: ["image/webp"],
    qualities: [58, 62, 64, 75],
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
