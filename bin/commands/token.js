/**
 * mindos token — Show auth token and MCP config snippet
 */

import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from '../lib/constants.js';
import { bold, dim, cyan, red } from '../lib/colors.js';
import { getLocalIP } from '../lib/startup.js';
import { MCP_AGENTS, detectAgentPresence } from '../lib/mcp-agents.js';
import { EXIT } from '../lib/command.js';

export const meta = {
  name: 'token',
  group: 'Connections',
  summary: 'Show auth token and MCP config',
  usage: 'mindos token',
  flags: {
    '--json': 'Output as JSON',
  },
  examples: [
    'mindos token',
    'mindos token --json',
  ],
};

export const run = (args, flags) => {
  if (!existsSync(CONFIG_PATH)) {
    console.error(red('No config found. Run `mindos onboard` first.'));
    process.exit(EXIT.ERROR);
  }

  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  const token = config.authToken || '';
  if (!token) {
    console.log(dim('No auth token set. Run `mindos onboard` to configure one.'));
    process.exit(0);
  }

  const mcpPort = config.mcpPort || 8781;
  const localIP = getLocalIP();
  const localUrl = `http://localhost:${mcpPort}/mcp`;

  if (flags.json) {
    console.log(JSON.stringify({
      token, mcpPort, localUrl,
      remoteUrl: localIP ? `http://${localIP}:${mcpPort}/mcp` : null,
    }, null, 2));
    return;
  }

  const sep = dim('━'.repeat(40));
  const snippet = (url) => JSON.stringify({
    mcpServers: { mindos: { url, headers: { Authorization: `Bearer ${token}` } } },
  }, null, 2);

  console.log(`\n${bold('Auth token:')} ${cyan(token)}\n`);

  const installed = [];
  const others = [];
  for (const [key, agent] of Object.entries(MCP_AGENTS)) {
    (detectAgentPresence(key) ? installed : others).push([key, agent]);
  }
  const toShow = [...installed.slice(0, 8), ...others.slice(0, Math.max(0, 3 - installed.length))];

  for (const [key, agent] of toShow) {
    console.log(sep);
    console.log(bold(agent.name));
    console.log(dim('Install:') + ` mindos mcp install ${key} -g -y`);
    if (agent.global) console.log(dim(`Config:  ${agent.global}`));
    console.log(snippet(localUrl));
    console.log();
  }

  if (localIP) {
    console.log(sep);
    console.log(bold('Remote MCP (other devices)'));
    console.log(`URL: ${cyan(`http://${localIP}:${mcpPort}/mcp`)}`);
    console.log(snippet(`http://${localIP}:${mcpPort}/mcp`));
  }

  // CLI Skill remote config
  const webPort = config.port || 3456;
  console.log(sep);
  console.log(bold('CLI Skill (remote access)'));
  console.log(dim('For agents with bash (Claude Code, Gemini CLI, Codex):'));
  console.log('');
  console.log(`  ${cyan('npm install -g @geminilight/mindos')}`);
  console.log(`  ${cyan(`mindos config set url http://${localIP || 'localhost'}:${webPort}`)}`);
  console.log(`  ${cyan(`mindos config set authToken ${token}`)}`);
  console.log(`  ${cyan('mindos file list')}  ${dim('# verify connection')}`);
  console.log('');

  if (toShow.length < installed.length) {
    console.log(dim(`\n  +${installed.length - toShow.length} more agents detected. Run \`mindos agent list\` to see all.`));
  }
  console.log(dim('\nRun `mindos onboard` to regenerate.\n'));
};
