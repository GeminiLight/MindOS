import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { CONFIG_PATH } from './constants.js';
import { bold, dim, cyan, green, yellow } from './colors.js';
import { getSyncStatus } from './sync.js';
import { checkForUpdate, printUpdateHint } from './update-check.js';
import { runSkillCheck } from './skill-check.js';
import { clearUpdateStatus } from './update-status.js';

export function getLocalIP() {
  try {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function printStartupInfo(webPort, mcpPort) {
  // Clear stale update status from previous update cycles
  clearUpdateStatus();

  // Fire update check immediately (non-blocking)
  const updatePromise = checkForUpdate().catch(() => null);

  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { /* ignore */ }
  const authToken = config.authToken || '';
  const localIP   = getLocalIP();

  console.log(`\n${'─'.repeat(53)}`);
  console.log(`${bold('🧠 MindOS is starting')}\n`);
  console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
  if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
  console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
  if (localIP) console.log(`             ${cyan(`http://${localIP}:${mcpPort}/mcp`)}`);

  if (authToken) {
    const maskedToken = authToken.length > 8 ? authToken.slice(0, 8) + '····' : (authToken.length > 4 ? authToken.slice(0, 4) + '····' : '····');
    console.log(`  ${green('●')} Auth     ${cyan(maskedToken)}  ${dim('(run `mindos token` for full config)')}`);
  }

  // MCP quick-connect hint
  console.log(`\n  ${dim('Quick connect:')}  ${cyan('mindos mcp install claude-code -g -y')}`);
  console.log(`  ${dim('Full config:')}    ${cyan('mindos token')}`);

  if (localIP) console.log(dim(`\n  💡 Remote? SSH port forwarding: ssh -L ${webPort}:localhost:${webPort} -L ${mcpPort}:localhost:${mcpPort} user@${localIP}`));

  // Sync status
  const mindRoot = config.mindRoot;
  if (mindRoot) {
    try {
      const syncStatus = getSyncStatus(mindRoot);
      if (syncStatus.enabled) {
        if (syncStatus.lastError) {
          console.log(`\n  ${yellow('!')} Sync   ${yellow('error')}: ${syncStatus.lastError}`);
        } else if (syncStatus.conflicts && syncStatus.conflicts.length > 0) {
          console.log(`\n  ${yellow('!')} Sync   ${yellow(`${syncStatus.conflicts.length} conflict(s)`)}  ${dim('run `mindos sync conflicts` to view')}`);
        } else {
          const unpushed = parseInt(syncStatus.unpushed || '0', 10);
          const extra = unpushed > 0 ? `  ${dim(`(${unpushed} unpushed)`)}` : '';
          console.log(`\n  ${green('●')} Sync   ${green('enabled')}  ${dim(syncStatus.remote || 'origin')}${extra}`);
        }
      } else {
        console.log(`\n  ${dim('○')} Sync   ${dim('not configured')}  ${dim('run `mindos sync init` to set up')}`);
      }
    } catch { /* sync check is best-effort */ }
  }

  // Wait for update check result (max 4s, then give up)
  const latestVersion = await Promise.race([
    updatePromise,
    new Promise(r => setTimeout(() => r(null), 4000)),
  ]);
  if (latestVersion) printUpdateHint(latestVersion);

  // Skill version check (best-effort, non-blocking)
  await runSkillCheck();

  console.log(`${'─'.repeat(53)}\n`);
}
