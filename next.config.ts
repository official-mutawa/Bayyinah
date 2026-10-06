import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The API reads the approved sources and their embeddings at runtime.
  outputFileTracingIncludes: {
    "/api/ask": ["./sources/**/*", "./data/**/*"],
  },
};

export default nextConfig;
