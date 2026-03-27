import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ['github-slugger'],
  serverExternalPackages: ['chokidar', 'openai', '@mariozechner/pi-ai', '@mariozechner/pi-agent-core', '@mariozechner/pi-coding-agent', 'mcporter'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  // Exclude Windows system directories from webpack file tracing.
  // GitHub Actions Windows runner has App Execution Aliases in AppData
  // that cause EACCES errors during standalone trace.
  outputFileTracingExcludes: {
    '*': ['**/AppData/**', '**/WindowsApps/**'],
  },
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
