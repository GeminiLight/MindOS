import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, CONFIG_PATH } from './constants.js';
import { bold, red } from './colors.js';

export function spawnMcp(verbose = false) {
  const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
  const webPort = process.env.MINDOS_WEB_PORT || '3456';

  const mcpBundle = resolve(ROOT, 'mcp', 'dist', 'index.cjs');
  if (!existsSync(mcpBundle)) {
    throw new Error(
      `MCP bundle not found: ${mcpBundle}\n` +
      `This MindOS installation may be corrupted. Try: npm install -g @geminilight/mindos@latest`,
    );
  }

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
  const child = spawn(process.execPath, [mcpBundle], {
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
