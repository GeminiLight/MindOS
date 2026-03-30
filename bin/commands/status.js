/**
 * mindos status — Show MindOS service status overview
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { CONFIG_PATH, ROOT, MINDOS_DIR, LOG_PATH } from '../lib/constants.js';
import { isPortInUse } from '../lib/port.js';
import { output, isJsonMode } from '../lib/command.js';
import { resolve } from 'node:path';

export const meta = {
  name: 'status',
  group: 'Core',
  summary: 'Show MindOS service status overview',
  usage: 'mindos status',
  examples: [
    'mindos status',
    'mindos status --json',
  ],
};

export async function run(_args, flags) {
  loadConfig();

  const webPort = process.env.MINDOS_WEB_PORT || '3456';
  const mcpPort = process.env.MINDOS_MCP_PORT || '8781';
  const mindRoot = process.env.MIND_ROOT || '';

  const webRunning = await isPortInUse(Number(webPort));
  const mcpRunning = await isPortInUse(Number(mcpPort));

  const pkgVersion = (() => {
    try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; }
  })();

  const configExists = existsSync(CONFIG_PATH);

  const logSize = (() => {
    try { return statSync(LOG_PATH).size; } catch { return 0; }
  })();

  const data = {
    version: pkgVersion,
    configured: configExists,
    mindRoot,
    web: { port: webPort, running: webRunning },
    mcp: { port: mcpPort, running: mcpRunning },
    logSize,
  };

  if (isJsonMode(flags)) {
    output(data, flags);
    return;
  }

  const indicator = (ok) => ok ? green('● running') : dim('○ stopped');

  console.log(`
${bold('MindOS Status')}  ${dim(`v${pkgVersion}`)}

  ${dim('Config:'.padEnd(15))}${configExists ? green('✔ configured') : red('✘ not configured')}
  ${dim('Mind Root:'.padEnd(15))}${mindRoot ? cyan(mindRoot) : dim('not set')}
  ${dim('Web Server:'.padEnd(15))}${indicator(webRunning)} ${dim(`(:${webPort})`)}
  ${dim('MCP Server:'.padEnd(15))}${indicator(mcpRunning)} ${dim(`(:${mcpPort})`)}
  ${dim('Log:'.padEnd(15))}${logSize > 0 ? dim(`${(logSize / 1024).toFixed(1)} KB`) : dim('empty')}
`);
}
