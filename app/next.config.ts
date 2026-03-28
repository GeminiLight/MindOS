import type { NextConfig } from "next";
import path from "path";

// When MindOS is installed globally via npm, the entire project lives
// under node_modules/@geminilight/mindos/. Next.js skips tsconfig path
// resolution and SWC TypeScript compilation for files inside node_modules.
// We detect this at config time and apply the necessary overrides.
const projectDir = path.resolve(__dirname);
const inNodeModules = projectDir.includes('node_modules');

const nextConfig: NextConfig = {
  transpilePackages: [
    'github-slugger',
    // Self-reference: ensures the SWC loader compiles our own TypeScript
    // when the project is inside node_modules (global npm install).
    ...(inNodeModules ? ['@geminilight/mindos'] : []),
  ],
  serverExternalPackages: ['chokidar', 'openai', '@mariozechner/pi-ai', '@mariozechner/pi-agent-core', '@mariozechner/pi-coding-agent', 'mcporter'],
  output: 'standalone',
  outputFileTracingRoot: projectDir,
  turbopack: {
    root: projectDir,
  },
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
  webpack: (config) => {
    if (inNodeModules) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = config.resolve.alias ?? {};
      (config.resolve.alias as Record<string, string>)['@'] = projectDir;
    }
    return config;
  },
};

export default nextConfig;
