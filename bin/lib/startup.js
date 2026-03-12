import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { CONFIG_PATH } from './constants.js';
import { bold, dim, cyan, green } from './colors.js';

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

export function printStartupInfo(webPort, mcpPort) {
  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { /* ignore */ }
  const authToken = config.authToken || '';
  const localIP   = getLocalIP();

  const auth = authToken
    ? `,\n        "headers": { "Authorization": "Bearer ${authToken}" }`
    : '';
  const block = (host) =>
    `  {\n    "mcpServers": {\n      "mindos": {\n        "url": "http://${host}:${mcpPort}/mcp"${auth}\n      }\n    }\n  }`;

  console.log(`\n${'─'.repeat(53)}`);
  console.log(`${bold('🧠 MindOS is starting')}\n`);
  console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
  if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
  console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
  if (localIP) console.log(`             ${cyan(`http://${localIP}:${mcpPort}/mcp`)}`);
  if (localIP) console.log(dim(`\n  💡 Running on a remote server? Open the Network URL (${localIP}) in your browser,\n     or use SSH port forwarding: ssh -L ${webPort}:localhost:${webPort} user@${localIP}`));
  console.log();
  console.log(bold('Configure MCP in your Agent:'));
  console.log(dim('  Local (same machine):'));
  console.log(block('localhost'));
  if (localIP) {
    console.log(dim('\n  Remote (other device):'));
    console.log(block(localIP));
  }
  if (authToken) {
    console.log(`\n  🔑 ${bold('Auth token:')} ${cyan(authToken)}`);
    console.log(dim('  Run `mindos token` anytime to view it again'));
  }
  console.log(dim('\n  Install Skills (optional):'));
  console.log(dim('  npx skills add https://github.com/GeminiLight/MindOS --skill mindos -g -y'));
  console.log(`${'─'.repeat(53)}\n`);
}
