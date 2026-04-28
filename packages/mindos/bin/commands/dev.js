/**
 * mindos dev — Start Next.js app and MCP server in development mode.
 *
 * Sets default ports, ensures app dependencies, spawns MCP, optionally starts
 * cross-device sync daemon, then runs `next dev --webpack`.
 */

import { resolve } from 'node:path';
import { CLI_PATH, WEB_APP_DIR } from '../lib/constants.js';
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
  const NEXT_BIN = resolve(WEB_APP_DIR, 'node_modules', '.bin', 'next');
  loadConfig();
  if (!process.env.MINDOS_WEB_PORT) process.env.MINDOS_WEB_PORT = '3456';
  if (!process.env.MINDOS_MCP_PORT) process.env.MINDOS_MCP_PORT = '8781';
  process.env.MINDOS_CLI_PATH = CLI_PATH;
  process.env.MINDOS_NODE_BIN = process.execPath;

  // Inject ~/.mindos/bin into PATH so dev server child processes can find `mindos` CLI
  const { homedir } = await import('node:os');
  const mindosBinDir = resolve(homedir(), '.mindos', 'bin');
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const pathDirs = (process.env.PATH || '').split(pathSep);
  if (!pathDirs.includes(mindosBinDir)) {
    process.env.PATH = `${mindosBinDir}${pathSep}${process.env.PATH || ''}`;
  }

  const webPort = process.env.MINDOS_WEB_PORT;
  const mcpPort = process.env.MINDOS_MCP_PORT;
  await assertPortFree(Number(webPort), 'web');
  await assertPortFree(Number(mcpPort), 'mcp');
  ensureAppDeps({ force: true }); // dev mode always needs packages/web/node_modules
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
  execInherited(`${NEXT_BIN} dev --webpack -p ${webPort} ${args.join(' ')}`, WEB_APP_DIR);
};
