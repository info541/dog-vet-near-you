import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/santa-barbara",
        destination: "/ca/santa-barbara",
        permanent: true,
      },
      {
        source: "/santa-barbara/:slug",
        destination: "/ca/santa-barbara/:slug",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
