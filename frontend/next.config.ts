import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Avoid Next.js auto-generating AGENTS.md/CLAUDE.md in this workspace —
  // CLAUDE.md is reserved for the user's own project instructions.
  agentRules: false,
};

export default nextConfig;
