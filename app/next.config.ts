import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['github-slugger'],
  serverExternalPackages: ['pdfjs-dist', 'pdf-parse'],
};

export default nextConfig;
