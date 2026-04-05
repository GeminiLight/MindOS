/**
 * mindos dev — Start Next.js app and MCP server in development mode.
 *
 * Sets default ports, ensures app dependencies, spawns MCP, optionally starts
 * cross-device sync daemon, then runs `next dev`.
 */

import { resolve } from 'node:path';
import { ROOT } from '../lib/constants.js';
import { loadConfig } from '../lib/config.js';
import { ensureAppDeps } from '../lib/build.js';
import { assertPortFree } from '../lib/port.js';
import { savePids, clearPids } from '../lib/pid.js';
import { printStartupInfo } from '../lib/startup.js';
import { spawnMcp } from '../lib/mcp-spawn.js';
import { execInherited } from '../lib/shell.js';

export const meta = {
  name: 'dev',
  group: 'Service',
  summary: 'Start in dev mode (hot reload)',
  usage: 'mindos dev',
  flags: {
    '--verbose': 'Show MCP server output',
  },
  examples: [
    'mindos dev',
    'mindos dev --verbose',
  ],
};

export const run = async (args, flags) => {
  const NEXT_BIN = resolve(ROOT, 'app', 'node_modules', '.bin', 'next');
  loadConfig();
  if (!process.env.MINDOS_WEB_PORT) process.env.MINDOS_WEB_PORT = '3456';
  if (!process.env.MINDOS_MCP_PORT) process.env.MINDOS_MCP_PORT = '8781';
  process.env.MINDOS_CLI_PATH = resolve(ROOT, 'bin', 'cli.js');
  process.env.MINDOS_NODE_BIN = process.execPath;
  const webPort = process.env.MINDOS_WEB_PORT;
  const mcpPort = process.env.MINDOS_MCP_PORT;
  await assertPortFree(Number(webPort), 'web');
  await assertPortFree(Number(mcpPort), 'mcp');
  ensureAppDeps({ force: true }); // dev mode always needs app/node_modules
  const { stopSyncDaemon, startSyncDaemon } = await import('../lib/sync.js');

  const mcp = spawnMcp(flags.verbose === true);
  savePids(process.pid, mcp.pid);
  process.on('exit', () => {
    try { stopSyncDaemon(); } catch {}
    clearPids();
  });
  const devMindRoot = process.env.MIND_ROOT;
  if (devMindRoot) {
    startSyncDaemon(devMindRoot).catch(() => {});
  }
  await printStartupInfo(webPort, mcpPort);
  execInherited(`${NEXT_BIN} dev -p ${webPort} ${args.join(' ')}`, resolve(ROOT, 'app'));
};
