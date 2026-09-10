import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project. A stray lockfile in the home
  // directory otherwise makes Next infer the wrong root for file tracing.
  outputFileTracingRoot: path.join(__dirname),
  // No ESLint config is shipped; don't block production builds on it.
  // TypeScript type-checking stays ON (the real safety net).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
