import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { cpus: 1 },
  images: {
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
