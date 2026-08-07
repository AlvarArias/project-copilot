import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the multi-stage Docker build (see /Dockerfile):
  // bundles only the traced production dependencies into .next/standalone.
  output: "standalone",
};

export default nextConfig;
