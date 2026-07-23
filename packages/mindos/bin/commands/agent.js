/**
 * mindos agent — AI Agent: interactive REPL (default) or one-shot (-p)
 *
 * Inspired by Claude Code: bare `mindos` or `mindos agent` enters interactive
 * mode; `mindos -p "task"` / `mindos agent -p "task"` prints and exits.
 *
 * Management subcommands (list/info/stats) are available as sub-routes.
 */

import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { MCP_AGENTS, detectAgentPresence } from '../lib/mcp-agents.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT } from '../lib/command.js';
import { startRepl } from '../lib/repl.js';
import { executeOneShot } from '../lib/one-shot.js';
import { expandHome } from '../lib/path-expand.js';
import { prepareAgentInvocation } from '../lib/agent-options.js';
import { inspectAgentReadiness } from '../lib/agent-readiness.js';

const MANAGEMENT_SUBCOMMANDS = new Set(['list', 'ls', 'info', 'stats', 'help']);

export const meta = {
  name: 'agent',
  group: 'AI',
  summary: 'MindOS AI Agent: interactive REPL or one-shot (-p)',
  usage: 'mindos agent [-p "<task>"] [options]',
  flags: {
    '-p, --print': 'Non-interactive: run task and print result',
    '--file <path>': 'Attach a file as context',
    '@<path>': 'Attach a file as context (positional shorthand)',
    '--provider <id>': 'Use a provider for this request',
    '--model <model>': 'Use a model for this request',
    '--thinking <level|budget|off>': 'Override thinking for this request',
    '--no-thinking': 'Disable thinking for this request',
    '--readonly': 'Run with read-only tool permissions',
    '--agent': 'Run with standard agent permissions (ask before risky writes)',
    '--cwd, --workdir <path>': 'Run this request from a working directory',
    '--max-steps <n>': 'Max agent steps (default: 20)',
    '--json': 'Output as JSON (implies -p)',
    '--port <port>': 'MindOS web port (default: 3456)',
  },
  examples: [
    'mindos                          # interactive REPL',
    'mindos "Summarize notes"        # top-level one-shot',
    'mindos -p "Organize my inbox"',
    'mindos @notes/today.md -p "Summarize"',
    'mindos agent -p "Organize my inbox"',
    'mindos agent --readonly --model claude-sonnet-4 "Review this"',
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

  const invocation = await prepareAgentInvocation(args, flags);

  // Determine mode: -p / --print / --json / bare task/stdin → print; otherwise interactive.
  const isPrintMode = flags.p || flags.print || isJsonMode(flags) || invocation.hasMessage;

  if (isPrintMode) {
    if (!invocation.hasMessage) {
      console.error(red('No task provided.'));
      console.error(dim('Usage: mindos agent -p "<task>"'));
      console.error(dim('       mindos -p "<task>"'));
      console.error(dim('       mindos agent    (interactive mode)'));
      process.exit(EXIT.ARGS);
    }
    return agentExecute(invocation, flags);
  }

  // Interactive REPL (default)
  return agentInteractive(flags, invocation);
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function agentInteractive(flags, invocation = {}) {
  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';
  const baseUrl = `http://localhost:${port}`;

  await startRepl({
    baseUrl,
    token,
    agentMode: 'default',
    permissionMode: invocation.permissionMode,
    prompt: 'agent> ',
    welcome: bold('MindOS Agent') + dim(' (interactive)'),
    showTools: true,
    attachedFiles: invocation.attachedFiles,
    maxSteps: invocation.maxSteps,
    providerOverride: invocation.providerOverride,
    modelOverride: invocation.modelOverride,
    runtimeOptions: invocation.runtimeOptions,
    agentOptions: invocation.agentOptions,
    workDir: invocation.workDir,
  });
}

// ---------------------------------------------------------------------------
// Print Mode — One-shot Task Execution
// ---------------------------------------------------------------------------

async function agentExecute(invocation, flags) {
  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';

  await executeOneShot({
    baseUrl: `http://localhost:${port}`,
    token,
    message: invocation.message,
    agentMode: 'default',
    permissionMode: invocation.permissionMode,
    showTools: true,
    maxSteps: invocation.maxSteps,
    attachedFiles: invocation.attachedFiles,
    providerOverride: invocation.providerOverride,
    modelOverride: invocation.modelOverride,
    runtimeOptions: invocation.runtimeOptions,
    agentOptions: invocation.agentOptions,
    workDir: invocation.workDir,
    json: isJsonMode(flags),
  });
}

// ---------------------------------------------------------------------------
// Agent Management — List / Info / Stats
// ---------------------------------------------------------------------------

function agentList(flags) {
  const agents = [];
  for (const [key, agent] of Object.entries(MCP_AGENTS)) {
    if (!detectAgentPresence(key)) continue;
    const readiness = inspectAgentReadiness(key);
    agents.push({
      key,
      name: agent.name,
      installed: true,
      mindosConnected: readiness.mcp.configured,
      skillInstalled: readiness.skill.installed,
      ready: readiness.ready,
      status: readiness.status,
    });
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
    const st = a.ready
      ? green('● ready')
      : a.mindosConnected
        ? yellow('● needs repair')
        : dim('○ not connected');
    console.log('  ' + a.name.padEnd(20) + ' ' + st);
  }
  console.log('\n' + dim('Connect/repair: mindos mcp install <agent-key> -g -y'));
  console.log(dim('Verify:         mindos doctor agents <agent-key>') + '\n');
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

  const readiness = inspectAgentReadiness(key);
  const installed = readiness.present;
  const connected = readiness.mcp.configured;
  const info = {
    key,
    name: agent.name,
    installed,
    mindosConnected: connected,
    skillInstalled: readiness.skill.installed,
    ready: readiness.ready,
    status: readiness.status,
    mcp: readiness.mcp,
    skill: readiness.skill,
    command: readiness.command,
    transport: agent.preferredTransport,
  };

  if (isJsonMode(flags)) {
    output(info, flags);
    return;
  }

  console.log('\n' + bold(agent.name));
  console.log('  Key:       ' + key);
  console.log('  Installed: ' + (installed ? green('yes') : red('no')));
  console.log('  MindOS:    ' + (readiness.ready ? green('ready') : connected ? yellow('needs repair') : yellow('not connected')));
  console.log('  MCP:       ' + (connected ? green(`${readiness.mcp.transport || 'configured'}`) : yellow('missing')));
  console.log('  Skill:     ' + (readiness.skill.installed ? green(readiness.skill.skillName) : red(`missing ${readiness.skill.skillName}`)));
  console.log('  Transport: ' + agent.preferredTransport);
  if (agent.global) console.log('  Config:    ' + expandHome(agent.global));
  console.log('  Doctor:    mindos doctor agents ' + key);
  if (!readiness.ready) console.log('\n  Repair: mindos mcp install ' + key + ' -g -y');
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
${bold('mindos agent')} — MindOS AI Agent with full tool access

${bold('Interactive (default):')}
  ${cyan('mindos')}                               Enter multi-turn REPL
  ${cyan('mindos agent')}                         Explicit REPL entrypoint
  ${dim('Commands inside REPL: /clear, /exit')}

${bold('Non-interactive (-p):')}
  ${cyan('mindos -p "<task>"')}                    Run task, print result, exit
  ${cyan('mindos "<task>"')}                       Same (shorthand)
  ${cyan('cat note.md | mindos -p "Summarize"')}   Read stdin as task context
  ${cyan('mindos @note.md -p "Summarize"')}        Attach file context
  ${cyan('mindos agent -p "<task>"')}              Explicit stable form
  ${cyan('mindos agent "<task>"')}                 Same (shorthand)

${bold('Manage agents:')}
  ${cyan('mindos agent list')}                    List detected AI agents
  ${cyan('mindos agent info <agent-key>')}        Show agent details
  ${cyan('mindos agent stats')}                   Usage statistics

${bold('Options:')}
  ${dim('-p, --print')}          Non-interactive mode
  ${dim('--file <path>')}        Attach file as context
  ${dim('@<path>')}              Attach file as context
  ${dim('--provider <id>')}      Provider override for this request
  ${dim('--model <model>')}      Model override for this request
  ${dim('--thinking <value>')}   Thinking override: off, minimal, low, medium, high, xhigh, max, or token budget
  ${dim('--no-thinking')}        Disable thinking for this request
  ${dim('--readonly')}           Read-only tool permissions
  ${dim('--agent')}              Full local agent permissions (default)
  ${dim('--cwd <path>')}         Working directory for this request
  ${dim('--max-steps <n>')}      Max agent steps (default: 20)
  ${dim('--json')}               JSON output (implies -p)

${bold('Note:')} ${cyan('mindos')} now opens the MindOS Agent by default.
Use ${cyan('mindos agent')} when scripts need the explicit stable command.
`);
}
