#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultEntrypointsByLayout = {
  platform: {
    cli: 'bin/cli.js',
    web: 'static-web/index.html',
    mcp: 'dist/protocols/mcp-server/index.cjs',
  },
  'bun-single-binary': {
    cli: 'bin/mindos',
    web: 'bin/mindos',
    mcp: 'bin/mindos',
  },
  'runtime-archive': {
    cli: 'bin/cli.js',
    web: 'packages/web/.next/standalone/server.js',
    mcp: 'dist/protocols/mcp-server/index.cjs',
  },
  'desktop-bundled': {
    cli: 'bin/cli.js',
    web: 'packages/web/.next/standalone/server.js',
    mcp: 'dist/protocols/mcp-server/index.cjs',
  },
};

const defaultArtifactsByLayout = {
  platform: [
    'bin/',
    'dist/',
    'src/cli.js',
    'src/cli.d.ts',
    'src/cli-runtime.js',
    'scripts/',
    'assets/',
    'skills/',
    'templates/',
    'static-web/',
    '_standalone/',
  ],
  'bun-single-binary': [
    'bin/mindos',
    'static-web/',
    'package.json',
    'runtime-manifest.json',
  ],
  'runtime-archive': [
    'bin/',
    'dist/',
    'src/',
    'scripts/',
    'skills/',
    'templates/',
    'packages/web/.next/standalone/',
    'packages/web/.next/static/',
    'packages/web/public/',
  ],
  'desktop-bundled': [
    'bin/',
    'dist/',
    'src/',
    'scripts/',
    'skills/',
    'templates/',
    'packages/web/.next/standalone/',
    'packages/web/.next/static/',
    'packages/web/public/',
    'node/',
  ],
};

export function createRuntimeManifest(options) {
  const layout = options.layout ?? 'platform';
  const productPkg = options.productPkg;
  if (!productPkg?.name || !productPkg?.version) {
    throw new Error('runtime manifest requires productPkg.name and productPkg.version');
  }

  return {
    schemaVersion: 1,
    product: {
      name: productPkg.name,
      version: productPkg.version,
    },
    package: {
      name: options.packageName ?? productPkg.name,
      platform: options.platform,
      os: options.os,
      cpu: options.cpu,
      layout,
    },
    entrypoints: options.entrypoints ?? defaultEntrypointsByLayout[layout] ?? defaultEntrypointsByLayout.platform,
    health: {
      route: '/api/health',
    },
    artifacts: options.artifacts ?? defaultArtifactsByLayout[layout] ?? defaultArtifactsByLayout.platform,
  };
}

export function writeRuntimeManifest(rootDir, options) {
  const manifest = createRuntimeManifest(options);
  writeFileSync(resolve(rootDir, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return manifest;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') parsed.root = argv[++i];
    else if (arg === '--platform') parsed.platform = argv[++i];
    else if (arg === '--layout') parsed.layout = argv[++i];
    else if (arg === '--package-name') parsed.packageName = argv[++i];
    else if (arg === '--os') parsed.os = argv[++i];
    else if (arg === '--cpu') parsed.cpu = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) throw new Error('--root is required');
  const packageJson = resolve(args.root, 'package.json');
  if (!existsSync(packageJson)) throw new Error(`package.json not found under runtime root: ${args.root}`);
  const productPkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
  const manifest = writeRuntimeManifest(args.root, {
    productPkg,
    packageName: args.packageName,
    platform: args.platform ?? `${process.platform}-${process.arch}`,
    os: args.os ?? process.platform,
    cpu: args.cpu ?? process.arch,
    layout: args.layout ?? 'runtime-archive',
  });
  console.log(`[runtime-manifest] ${manifest.package.layout}:${manifest.package.platform} -> ${resolve(args.root, 'runtime-manifest.json')}`);
}
