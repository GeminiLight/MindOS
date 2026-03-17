import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './constants.js';
import { bold, red, yellow } from './colors.js';

export function spawnMcp(verbose = false) {
  const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
  const webPort = process.env.MINDOS_WEB_PORT || '3456';
  // Ensure mcp/node_modules exists (auto-install on first run)
  const mcpSdk = resolve(ROOT, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
  if (!existsSync(mcpSdk)) {
    console.log(yellow('Installing MCP dependencies (first run)...\n'));
    execSync('npm install --prefer-offline --no-workspaces', { cwd: resolve(ROOT, 'mcp'), stdio: 'inherit' });
  }
  const env = {
    ...process.env,
    MCP_PORT: mcpPort,
    MINDOS_URL: process.env.MINDOS_URL || `http://127.0.0.1:${webPort}`,
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
