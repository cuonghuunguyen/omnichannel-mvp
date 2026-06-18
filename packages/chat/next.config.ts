import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The AI Config API client is a workspace TS package (no build step); Next
  // transpiles its source as part of the chat app.
  transpilePackages: ["@agent-routing/api-client"],
};

export default nextConfig;
