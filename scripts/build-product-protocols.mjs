#!/usr/bin/env node
/**
 * Bundle product-owned protocol runtimes after the TypeScript declaration build.
 *
 * ACP and MCP live under packages/mindos/src/protocols so the npm product
 * package owns their runtime boundary. Their SDKs are build-time inputs only;
 * published runtime entrypoints are self-contained bundles.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const productRoot = resolve(root, 'packages', 'mindos');
const requireFromProduct = createRequire(resolve(productRoot, 'package.json'));
const { build } = requireFromProduct('esbuild');

const entries = [
  {
    name: 'ACP',
    entryPoint: resolve(productRoot, 'src', 'protocols', 'acp', 'index.ts'),
    outfile: resolve(productRoot, 'dist', 'protocols', 'acp', 'index.js'),
    format: 'esm',
  },
  {
    name: 'MCP',
    entryPoint: resolve(productRoot, 'src', 'protocols', 'mcp-server', 'index.ts'),
    outfile: resolve(productRoot, 'dist', 'protocols', 'mcp-server', 'index.cjs'),
    format: 'cjs',
  },
];

for (const entry of entries) {
  if (!existsSync(entry.entryPoint)) {
    throw new Error(`[build-product-protocols] Missing ${entry.name} entrypoint: ${entry.entryPoint}`);
  }

  mkdirSync(dirname(entry.outfile), { recursive: true });
  await build({
    entryPoints: [entry.entryPoint],
    outfile: entry.outfile,
    bundle: true,
    platform: 'node',
    format: entry.format,
    target: 'node18',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
  });
}

console.log('[build-product-protocols] OK - bundled ACP and MCP protocol runtimes');
