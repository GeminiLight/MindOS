import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT } from './constants.js';
import { yellow } from './colors.js';
import { execNpmInherited } from './shell.js';

export const MCP_DIR = PACKAGE_ROOT;
export const MCP_SRC_DIR = resolve(PACKAGE_ROOT, 'src', 'protocols', 'mcp-server');
export const MCP_BUNDLE = resolve(PACKAGE_ROOT, 'dist', 'protocols', 'mcp-server', 'index.cjs');

const MCP_PACKAGE_JSON = resolve(PACKAGE_ROOT, 'package.json');
// `npm run build:protocols` executes `node ../../scripts/build-product-protocols.mjs`
// relative to MCP_DIR — it only exists in a monorepo checkout.
const MONOREPO_PROTOCOLS_BUILDER = resolve(PACKAGE_ROOT, '..', '..', 'scripts', 'build-product-protocols.mjs');

function safeMtime(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function latestTreeMtime(dirPath) {
  if (!existsSync(dirPath)) return 0;

  let latest = safeMtime(dirPath);
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestTreeMtime(fullPath));
    } else {
      latest = Math.max(latest, safeMtime(fullPath));
    }
  }
  return latest;
}

function isPackagedNpmRuntime() {
  return existsSync(resolve(PACKAGE_ROOT, '_standalone', '__next')) &&
    existsSync(resolve(PACKAGE_ROOT, '_standalone', '__node_modules'));
}

export function needsMcpBuild() {
  if (!existsSync(MCP_BUNDLE)) return true;
  if (isPackagedNpmRuntime()) return false;

  const bundleMtime = safeMtime(MCP_BUNDLE);
  const sourceMtime = Math.max(
    latestTreeMtime(MCP_SRC_DIR),
    safeMtime(MCP_PACKAGE_JSON),
  );

  return sourceMtime > bundleMtime;
}

export function ensureMcpBundle() {
  if (!needsMcpBuild()) return;

  const hadBundle = existsSync(MCP_BUNDLE);

  // If src/ doesn't exist (npm install scenario), skip rebuild and use prebuilt bundle
  if (!existsSync(MCP_SRC_DIR)) {
    if (hadBundle) {
      return; // Use prebuilt bundle from npm package
    }
    throw new Error(`MCP bundle not found and source directory missing: ${MCP_SRC_DIR}`);
  }

  // Packaged runtimes (e.g. the Desktop copy under ~/.mindos/runtime) ship src/
  // but not the monorepo build script. Rebuilding there is impossible — and a
  // package.json copied a few ms after the bundle would otherwise trigger a
  // doomed rebuild on every startup. Trust the shipped bundle instead.
  if (!existsSync(MONOREPO_PROTOCOLS_BUILDER)) {
    if (hadBundle) {
      return;
    }
    throw new Error(`MCP bundle not found and protocols builder missing: ${MONOREPO_PROTOCOLS_BUILDER}`);
  }

  // stderr, never stdout: with MCP_TRANSPORT=stdio any stray stdout line
  // corrupts the JSON-RPC stream ("invalid character 'R' ..." on the client).
  console.error(yellow(hadBundle
    ? 'Rebuilding MCP bundle (source changed)...\n'
    : 'Building MCP bundle (first run)...\n'));
  execNpmInherited(['run', 'build:protocols'], MCP_DIR);

  if (!existsSync(MCP_BUNDLE)) {
    throw new Error(`MCP bundle build did not produce ${MCP_BUNDLE}`);
  }
}
