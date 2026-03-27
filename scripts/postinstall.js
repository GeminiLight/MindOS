#!/usr/bin/env node
/**
 * npm postinstall — ensure mcp/node_modules is present after `npm install -g`.
 *
 * The npm tarball excludes mcp/node_modules (too large, platform-specific native deps).
 * Without this, Desktop users must wait for runtime auto-install, which fails on
 * older Desktop builds that lack the first-install logic in ensureBundledMcpNodeModules().
 *
 * Belt-and-suspenders: CLI spawnMcp() and Desktop ensureBundledMcpNodeModules()
 * also auto-install at runtime, but this postinstall eliminates the gap entirely.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const mcpDir = resolve(ROOT, 'mcp');
const sdkPkg = resolve(mcpDir, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');

if (!existsSync(resolve(mcpDir, 'package.json'))) process.exit(0);
if (existsSync(sdkPkg)) process.exit(0);

console.log('[MindOS] Installing MCP dependencies...');

try {
  execSync('npm install --omit=dev --no-workspaces --prefer-offline', {
    cwd: mcpDir, stdio: 'inherit',
  });
} catch {
  try {
    execSync('npm install --omit=dev --no-workspaces', {
      cwd: mcpDir, stdio: 'inherit',
    });
  } catch {
    console.warn('[MindOS] MCP dependency install failed (non-fatal). Will retry on first run.');
  }
}
