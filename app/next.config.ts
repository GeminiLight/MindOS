import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ['github-slugger'],
  serverExternalPackages: [
    'chokidar',
    'openai',
    '@mariozechner/pi-ai',
    '@mariozechner/pi-agent-core',
    '@mariozechner/pi-coding-agent',
    'mcporter',
    // Build-time only: Next.js image optimization
    'sharp',
    '@img/*',
    // Build-time only: TypeScript compiler
    'typescript',
    // CLI-only: Terminal UI and native FFI
    'cli-highlight',
    '@mariozechner/pi-tui',
    'koffi',
  ],
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
    // Optimize lucide-react bundle: tree-shake unused icons (1000+ → 117 actual)
    // Next.js SWC plugin converts named imports to deep imports for bundler to tree-shake
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
