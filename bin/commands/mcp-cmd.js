/**
 * mindos mcp — MCP server management
 */

import { resolve } from 'node:path';
import { ROOT } from '../lib/constants.js';
import { loadConfig } from '../lib/config.js';
import { execInherited } from '../lib/shell.js';
import { printCommandHelp } from '../lib/command.js';

export const meta = {
  name: 'mcp',
  group: 'Connections',
  summary: 'Manage AI agent connections',
  usage: 'mindos mcp [install [agent]]',
  examples: [
    'mindos mcp',
    'mindos mcp install',
    'mindos mcp install cursor',
  ],
};

export const run = async (args) => {
  const sub = args[0];
  const hasInstallFlags = args.some(a => ['-g', '--global', '-y', '--yes'].includes(a));

  if (sub === 'install' || hasInstallFlags) {
    const { mcpInstall } = await import('../lib/mcp-install.js');
    await mcpInstall();
    return;
  }

  // No subcommand in interactive terminal → show help
  // (stdio mode is only meaningful when piped by an AI agent)
  if (!sub && process.stdin.isTTY) {
    printCommandHelp({ meta });
    return;
  }

  loadConfig();

  const { ensureMcpBundle } = await import('../lib/mcp-build.js');
  await ensureMcpBundle();

  if (!process.env.MCP_TRANSPORT) {
    process.env.MCP_TRANSPORT = 'stdio';
  }

  const webPort = process.env.MINDOS_WEB_PORT || '3456';
  process.env.MINDOS_URL = process.env.MINDOS_URL || `http://localhost:${webPort}`;

  if (process.env.MCP_TRANSPORT === 'http') {
    process.env.MCP_PORT = process.env.MINDOS_MCP_PORT || '8781';
  }

  execInherited(`node dist/index.cjs`, resolve(ROOT, 'mcp'));
};
