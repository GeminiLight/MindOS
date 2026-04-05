/**
 * mindos agent — AI Agent: interactive REPL (default) or one-shot (-p)
 *
 * Inspired by Claude Code: bare `mindos agent` enters interactive mode;
 * `mindos agent -p "task"` prints the result and exits.
 *
 * Management subcommands (list/info/stats) are available as sub-routes.
 */

import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { MCP_AGENTS, detectAgentPresence } from '../lib/mcp-agents.js';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT } from '../lib/command.js';
import { startRepl } from '../lib/repl.js';
import { executeOneShot } from '../lib/one-shot.js';
import { expandHome } from '../lib/path-expand.js';

const MANAGEMENT_SUBCOMMANDS = new Set(['list', 'ls', 'info', 'stats', 'help']);

export const meta = {
  name: 'agent',
  group: 'AI',
  summary: 'AI Agent: interactive REPL or one-shot (-p)',
  usage: 'mindos agent [-p "<task>"]',
  flags: {
    '-p, --print': 'Non-interactive: run task and print result',
    '--file <path>': 'Attach a file as context',
    '--max-steps <n>': 'Max agent steps (default: 20)',
    '--json': 'Output as JSON (implies -p)',
    '--port <port>': 'MindOS web port (default: 3456)',
  },
  examples: [
    'mindos agent                    # interactive REPL',
    'mindos agent -p "Organize my inbox"',
    'mindos agent "Summarize notes"  # also one-shot',
    'mindos agent list               # list detected agents',
  ],
};

export async function run(args, flags) {
  const sub = args[0];

  // Management subcommands always take priority
  if (sub && MANAGEMENT_SUBCOMMANDS.has(sub)) {
    if (sub === 'help') { printHelp(); return; }
    if (sub === 'list' || sub === 'ls') return agentList(flags);
    if (sub === 'info') return agentInfo(args[1], flags);
    if (sub === 'stats') return agentStats(flags);
    return;
  }

  // Determine mode: -p / --print / --json / bare task → print; otherwise interactive
  const isPrintMode = flags.p || flags.print || isJsonMode(flags) || (sub != null);

  if (isPrintMode) {
    const task = args.join(' ');
    if (!task) {
      console.error(red('No task provided.'));
      console.error(dim('Usage: mindos agent -p "<task>"'));
      console.error(dim('       mindos agent    (interactive mode)'));
      process.exit(EXIT.ARGS);
    }
    return agentExecute(task, flags);
  }

  // Interactive REPL (default)
  return agentInteractive(flags);
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function agentInteractive(flags) {
  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';
  const baseUrl = `http://localhost:${port}`;

  const maxSteps = (() => {
    if (!flags['max-steps']) return undefined;
    const n = parseInt(flags['max-steps'], 10);
    return (!Number.isNaN(n) && n > 0) ? n : undefined;
  })();

  await startRepl({
    baseUrl,
    token,
    mode: 'agent',
    prompt: 'agent> ',
    welcome: bold('MindOS Agent') + dim(' (interactive) — full tool access'),
    showTools: true,
    attachedFiles: flags.file ? [flags.file] : undefined,
    maxSteps,
  });
}

// ---------------------------------------------------------------------------
// Print Mode — One-shot Task Execution
// ---------------------------------------------------------------------------

async function agentExecute(task, flags) {
  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';

  const maxSteps = (() => {
    if (!flags['max-steps']) return undefined;
    const n = parseInt(flags['max-steps'], 10);
    return (!Number.isNaN(n) && n > 0) ? n : undefined;
  })();

  await executeOneShot({
    baseUrl: `http://localhost:${port}`,
    token,
    message: task,
    mode: 'agent',
    showTools: true,
    maxSteps,
    attachedFiles: flags.file ? [flags.file] : undefined,
    json: isJsonMode(flags),
  });
}

// ---------------------------------------------------------------------------
// Agent Management — List / Info / Stats
// ---------------------------------------------------------------------------

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
    process.exit(EXIT.ARGS);
  }
  const agent = MCP_AGENTS[key];
  if (!agent) {
    console.error(red('Unknown agent: ' + key));
    console.error(dim('Available: ' + Object.keys(MCP_AGENTS).join(', ')));
    process.exit(EXIT.NOT_FOUND);
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

function agentStats(flags) {
  if (isJsonMode(flags)) {
    output({ message: 'Agent usage statistics are not yet available.' }, flags);
    return;
  }
  console.log(dim('\n  Agent usage statistics are not yet available.'));
  console.log(dim('  This feature will be added in a future release.\n'));
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function printHelp() {
  console.log(`
${bold('mindos agent')} — AI Agent with full tool access

${bold('Interactive (default):')}
  ${cyan('mindos agent')}                         Enter multi-turn REPL
  ${dim('Commands inside REPL: /clear, /exit')}

${bold('Non-interactive (-p):')}
  ${cyan('mindos agent -p "<task>"')}              Run task, print result, exit
  ${cyan('mindos agent "<task>"')}                 Same (shorthand)

${bold('Manage agents:')}
  ${cyan('mindos agent list')}                    List detected AI agents
  ${cyan('mindos agent info <agent-key>')}        Show agent details
  ${cyan('mindos agent stats')}                   Usage statistics

${bold('Options:')}
  ${dim('-p, --print')}          Non-interactive mode
  ${dim('--file <path>')}        Attach file as context
  ${dim('--max-steps <n>')}      Max agent steps (default: 20)
  ${dim('--json')}               JSON output (implies -p)

${bold('Note:')} For lightweight Q&A (read-only), use ${cyan('mindos ask')}.
`);
}
