import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { MCP_AGENTS, detectAgentPresence } from '../lib/mcp-agents.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { output, isJsonMode, EXIT } from '../lib/command.js';

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export const meta = {
  name: 'agent',
  group: 'Knowledge',
  summary: 'AI Agent management (list/info)',
  usage: 'mindos agent <subcommand>',
};

export async function run(args, flags) {
  const sub = args[0];
  if (!sub || flags.help || flags.h) {
    console.log(bold('mindos agent') + ' — AI Agent management\n');
    console.log('Subcommands:');
    console.log('  list              List detected AI agents');
    console.log('  info <agent-key>  Show agent details\n');
    console.log('Keys: ' + Object.keys(MCP_AGENTS).join(', '));
    return;
  }
  if (sub === 'list' || sub === 'ls') return agentList(flags);
  if (sub === 'info') return agentInfo(args[1], flags);
  console.error(red('Unknown subcommand: ' + sub));
  process.exit(EXIT.ARGS);
}

function hasMindosConfig(agent) {
  const paths = [agent.global, agent.project].filter(Boolean).map(expandHome);
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf-8')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const data = JSON.parse(raw);
      const servers = data[agent.key] || {};
      if (Object.keys(servers).some(k => k.toLowerCase().includes('mindos'))) return true;
    } catch { /* skip */ }
  }
  return false;
}

function agentList(flags) {
  const agents = [];
  for (const [key, agent] of Object.entries(MCP_AGENTS)) {
    if (!detectAgentPresence(key)) continue;
    agents.push({ key, name: agent.name, installed: true, mindosConnected: hasMindosConfig(agent) });
  }

  if (isJsonMode(flags)) {
    output({ count: agents.length, agents }, flags);
    return;
  }

  if (agents.length === 0) {
    console.log(dim('No AI agents detected.'));
    return;
  }

  console.log('\n' + bold('Detected Agents (' + agents.length + '):') + '\n');
  for (const a of agents) {
    const st = a.mindosConnected ? green('● connected') : dim('○ not connected');
    console.log('  ' + a.name.padEnd(20) + ' ' + st);
  }
  console.log('\n' + dim('Connect: mindos mcp install <agent-key>') + '\n');
}

function agentInfo(key, flags) {
  if (!key) {
    console.error(red('Usage: mindos agent info <agent-key>'));
    process.exit(EXIT.ERROR);
  }
  const agent = MCP_AGENTS[key];
  if (!agent) {
    console.error(red('Unknown agent: ' + key));
    process.exit(EXIT.ERROR);
  }

  const installed = detectAgentPresence(key);
  const connected = installed ? hasMindosConfig(agent) : false;
  const info = {
    key,
    name: agent.name,
    installed,
    mindosConnected: connected,
    transport: agent.preferredTransport,
  };

  if (isJsonMode(flags)) {
    output(info, flags);
    return;
  }

  console.log('\n' + bold(agent.name));
  console.log('  Key:       ' + key);
  console.log('  Installed: ' + (installed ? green('yes') : red('no')));
  console.log('  MindOS:    ' + (connected ? green('connected') : yellow('not connected')));
  console.log('  Transport: ' + agent.preferredTransport);
  if (agent.global) console.log('  Config:    ' + expandHome(agent.global));
  if (!connected && installed) console.log('\n  Connect: mindos mcp install ' + key);
  console.log('');
}
