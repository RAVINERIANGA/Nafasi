import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  allowedDevOrigins: ["192.168.1.161"],
};

export default nextConfig;
