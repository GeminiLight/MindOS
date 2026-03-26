import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { ROOT, CONFIG_PATH } from './constants.js';
import { bold, red, yellow } from './colors.js';
import { npmInstall } from './utils.js';

/**
 * If mcp/node_modules was installed on a different platform (e.g. Linux CI → macOS user),
 * native packages like esbuild will crash. Detect via stamp or @esbuild heuristics, then reinstall.
 */
function ensureMcpNativeDeps() {
  const mcpDir = resolve(ROOT, 'mcp');
  const nm = resolve(mcpDir, 'node_modules');
  if (!existsSync(nm)) return;

  const host = `${platform()}-${arch()}`;
  const stamp = resolve(mcpDir, '.mindos-npm-ci-platform');
  let needsReinstall = false;

  if (existsSync(stamp)) {
    try {
      needsReinstall = readFileSync(stamp, 'utf-8').trim() !== host;
    } catch { /* fall through */ }
  } else {
    const esbuildDir = resolve(nm, '@esbuild');
    if (existsSync(esbuildDir)) {
      try {
        const names = readdirSync(esbuildDir);
        if (names.length > 0 && !names.includes(host)) needsReinstall = true;
      } catch { /* ignore */ }
    }
  }

  if (!needsReinstall) return;

  console.log(yellow('MCP dependencies were built for another platform — reinstalling...'));
  rmSync(nm, { recursive: true, force: true });
  npmInstall(mcpDir, '--no-workspaces');
  try { writeFileSync(stamp, host, 'utf-8'); } catch { /* non-fatal */ }
}

export function spawnMcp(verbose = false) {
  const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
  const webPort = process.env.MINDOS_WEB_PORT || '3456';
  // Ensure mcp/node_modules exists (auto-install on first run)
  const mcpSdk = resolve(ROOT, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
  if (!existsSync(mcpSdk)) {
    console.log(yellow('Installing MCP dependencies (first run)...\n'));
    npmInstall(resolve(ROOT, 'mcp'), '--no-workspaces');
  }
  ensureMcpNativeDeps();

  // Read AUTH_TOKEN directly from config to avoid stale system env overriding
  // the user's configured token. Config is the source of truth for auth.
  let configAuthToken;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    configAuthToken = cfg.authToken;
  } catch { /* config may not exist yet */ }

  const env = {
    ...process.env,
    MCP_TRANSPORT: 'http',
    MCP_PORT: mcpPort,
    MCP_HOST: process.env.MCP_HOST || '0.0.0.0',
    MINDOS_URL: process.env.MINDOS_URL || `http://127.0.0.1:${webPort}`,
    ...(configAuthToken ? { AUTH_TOKEN: configAuthToken } : {}),
    ...(verbose ? { MCP_VERBOSE: '1' } : {}),
  };
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: resolve(ROOT, 'mcp'),
    stdio: 'inherit',
    env,
  });
  child.on('error', (err) => {
    if (err.message.includes('EADDRINUSE')) {
      console.error(`\n${red('\u2718')} ${bold(`MCP port ${mcpPort} is already in use`)}`);
      console.error(`  ${'Run:'} mindos stop\n`);
    } else {
      console.error(red('MCP server error:'), err.message);
    }
  });
  return child;
}
