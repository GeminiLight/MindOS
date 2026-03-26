import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ['github-slugger'],
  serverExternalPackages: ['chokidar', 'openai', '@mariozechner/pi-ai', '@mariozechner/pi-agent-core', '@mariozechner/pi-coding-agent', 'mcporter'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  // Disable client-side router cache for dynamic layouts so that
  // router.refresh() always fetches a fresh file tree from the server.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
