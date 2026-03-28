import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './constants.js';
import { yellow } from './colors.js';
import { run, npmInstall } from './utils.js';

export const MCP_DIR = resolve(ROOT, 'mcp');
export const MCP_SRC_DIR = resolve(MCP_DIR, 'src');
export const MCP_BUNDLE = resolve(MCP_DIR, 'dist', 'index.cjs');

const MCP_PACKAGE_JSON = resolve(MCP_DIR, 'package.json');
const MCP_PACKAGE_LOCK = resolve(MCP_DIR, 'package-lock.json');
const MCP_SDK = resolve(MCP_DIR, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
const MCP_ESBUILD = resolve(MCP_DIR, 'node_modules', 'esbuild', 'package.json');

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

function hasBuildDeps() {
  return existsSync(MCP_SDK) && existsSync(MCP_ESBUILD);
}

export function needsMcpBuild() {
  if (!existsSync(MCP_BUNDLE)) return true;

  const bundleMtime = safeMtime(MCP_BUNDLE);
  const sourceMtime = Math.max(
    latestTreeMtime(MCP_SRC_DIR),
    safeMtime(MCP_PACKAGE_JSON),
    safeMtime(MCP_PACKAGE_LOCK),
  );

  return sourceMtime > bundleMtime;
}

export function ensureMcpBundle() {
  if (!needsMcpBuild()) return;

  const hadBundle = existsSync(MCP_BUNDLE);

  if (!hasBuildDeps()) {
    console.log(yellow('Installing MCP build dependencies...\n'));
    npmInstall(MCP_DIR, '--no-workspaces');
  }

  console.log(yellow(hadBundle
    ? 'Rebuilding MCP bundle (source changed)...\n'
    : 'Building MCP bundle (first run)...\n'));
  run('npm run build', MCP_DIR);

  if (!existsSync(MCP_BUNDLE)) {
    throw new Error(`MCP bundle build did not produce ${MCP_BUNDLE}`);
  }
}
