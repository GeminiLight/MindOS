/**
 * mindos restart — Stop then start again
 */

import { loadConfig, getStartMode } from '../lib/config.js';
import { stopMindos } from '../lib/stop.js';
import { isPortInUse } from '../lib/port.js';

export const meta = {
  name: 'restart',
  group: 'Service',
  summary: 'Restart services',
  usage: 'mindos restart',
};

export const run = async (args, flags) => {
  const oldWebPort = process.env.MINDOS_OLD_WEB_PORT || process.env.MINDOS_WEB_PORT;
  const oldMcpPort = process.env.MINDOS_OLD_MCP_PORT || process.env.MINDOS_MCP_PORT;

  loadConfig();

  const newWebPort = Number(process.env.MINDOS_WEB_PORT || '3456');
  const newMcpPort = Number(process.env.MINDOS_MCP_PORT || '8781');

  const extraPorts = [];
  if (oldWebPort && Number(oldWebPort) !== newWebPort) extraPorts.push(oldWebPort);
  if (oldMcpPort && Number(oldMcpPort) !== newMcpPort) extraPorts.push(oldMcpPort);

  stopMindos({ extraPorts });

  const allPorts = new Set([newWebPort, newMcpPort]);
  for (const p of extraPorts) allPorts.add(Number(p));

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    let anyBusy = false;
    for (const p of allPorts) {
      if (await isPortInUse(p)) { anyBusy = true; break; }
    }
    if (!anyBusy) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Dynamically resolve start mode and dispatch
  const mode = getStartMode();
  const startCmd = await import(`./${mode}.js`);
  await startCmd.run(args, flags);
};
