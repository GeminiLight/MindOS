import { readFileSync } from 'node:fs';

import { PRODUCT_PACKAGE_JSON } from '../bin/lib/constants.js';
import { bold, dim, cyan } from '../bin/lib/colors.js';
import { parseArgs, printCommandHelp } from '../bin/lib/command.js';
import {
  MINDOS_ADDITIONAL_COMMANDS,
  MINDOS_CORE_COMMANDS,
  commandEntries,
  createCommandRegistry,
} from './cli.js';

// Command modules are lazy-loaded: `mindos --version` and single-command runs
// must not pay the import cost of every command module (each pulls in its own
// dependency tree). Only global help loads everything.
const agentCmd = () => import('../bin/commands/agent.js');
const askCmd = () => import('../bin/commands/ask.js');
const fileCmd = () => import('../bin/commands/file.js');
const spaceCmd = () => import('../bin/commands/space.js');
const searchCmd = () => import('../bin/commands/search.js');
const startCmd = () => import('../bin/commands/start.js');
const devCmd = () => import('../bin/commands/dev.js');
const stopCmd = () => import('../bin/commands/stop.js');
const restartCmd = () => import('../bin/commands/restart.js');
const buildCmd = () => import('../bin/commands/build.js');
const statusCmd = () => import('../bin/commands/status.js');
const openCmd = () => import('../bin/commands/open.js');
const mcpCmd = () => import('../bin/commands/mcp-cmd.js');
const tokenCmd = () => import('../bin/commands/token.js');
const syncCmd = () => import('../bin/commands/sync-cmd.js');
const gatewayCmd = () => import('../bin/commands/gateway.js');
const onboardCmd = () => import('../bin/commands/onboard.js');
const configCmd = () => import('../bin/commands/config.js');
const authCmd = () => import('../bin/commands/auth.js');
const doctorCmd = () => import('../bin/commands/doctor.js');
const updateCmd = () => import('../bin/commands/update.js');
const uninstallCmd = () => import('../bin/commands/uninstall.js');
const logsCmd = () => import('../bin/commands/logs.js');
const apiCmd = () => import('../bin/commands/api.js');
const initSkillsCmd = () => import('../bin/commands/init-skills.js');
const channelCmd = () => import('../bin/commands/channel.js');
const feishuWsCmd = () => import('../bin/commands/feishu-ws.js');

const commandLoaders = [
  agentCmd,
  askCmd,
  fileCmd,
  spaceCmd,
  searchCmd,
  startCmd,
  devCmd,
  stopCmd,
  restartCmd,
  buildCmd,
  statusCmd,
  openCmd,
  mcpCmd,
  tokenCmd,
  syncCmd,
  gatewayCmd,
  onboardCmd,
  configCmd,
  authCmd,
  channelCmd,
  feishuWsCmd,
  doctorCmd,
  updateCmd,
  uninstallCmd,
  logsCmd,
  apiCmd,
  initSkillsCmd,
];

const loaderByDisplayName = {
  agent: agentCmd,
  ask: askCmd,
  start: startCmd,
  'serve': startCmd,
  stop: stopCmd,
  status: statusCmd,
  open: openCmd,
  file: fileCmd,
  space: spaceCmd,
  search: searchCmd,
  mcp: mcpCmd,
  onboard: onboardCmd,
  init: onboardCmd,
  config: configCmd,
  auth: authCmd,
  channel: channelCmd,
  'feishu-ws': feishuWsCmd,
  doctor: doctorCmd,
  update: updateCmd,
  dev: devCmd,
  build: buildCmd,
  restart: restartCmd,
  sync: syncCmd,
  gateway: gatewayCmd,
  token: tokenCmd,
  logs: logsCmd,
  api: apiCmd,
  'init-skills': initSkillsCmd,
  uninstall: uninstallCmd,
};

let allCommandModules = null;

function loadAllCommandModules() {
  if (!allCommandModules) {
    allCommandModules = Promise.all(commandLoaders.map((load) => load()));
  }
  return allCommandModules;
}

async function loadCommandRegistry() {
  return createCommandRegistry(await loadAllCommandModules());
}

async function loadModulesByDisplayName() {
  const names = Object.keys(loaderByDisplayName);
  const mods = await Promise.all(names.map((name) => loaderByDisplayName[name]()));
  return Object.fromEntries(names.map((name, i) => [name, mods[i]]));
}

/**
 * Resolve a single command by name. The fast path imports just that module;
 * meta-only aliases (e.g. `setup`) fall back to the full registry.
 */
async function resolveCommandModule(name) {
  const loader = loaderByDisplayName[name];
  if (loader) return loader();
  const registry = await loadCommandRegistry();
  return registry[name] ?? null;
}

function readProductVersion() {
  try {
    return JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
  } catch {
    return '?';
  }
}

async function showGlobalHelp(showAll = false) {
  const moduleByDisplayName = await loadModulesByDisplayName();
  const row = ([name, mod]) => `  ${cyan(name.padEnd(14))}${dim(mod.meta.summary)}`;
  const coreEntries = commandEntries(MINDOS_CORE_COMMANDS, moduleByDisplayName);
  const additionalEntries = commandEntries(MINDOS_ADDITIONAL_COMMANDS, moduleByDisplayName);

  const lines = [
    '',
    `${bold('MindOS CLI')} ${dim(`v${readProductVersion()}`)}`,
    '',
    `${bold('USAGE')}`,
    `  ${cyan('mindos [task] [flags]')}`,
    `  ${cyan('mindos <command> [flags]')}`,
    '',
    `${bold('COMMANDS')}`,
    ...coreEntries.map(row),
  ];

  if (showAll) {
    lines.push('', `${bold('ADDITIONAL COMMANDS')}`);
    lines.push(...additionalEntries.map(row));
  }

  const flagRow = (flag, description) => `  ${cyan(flag.padEnd(14))}${dim(description)}`;
  lines.push(
    '',
    `${bold('FLAGS')}`,
    flagRow('--help, -h', 'Show help'),
    flagRow('--version, -v', 'Show version'),
    flagRow('--json', 'Output as JSON'),
    '',
    `  ${dim('Run')} ${cyan('mindos')} ${dim('to open the MindOS Agent.')}`,
    `  ${dim('Run')} ${cyan('mindos -p "<task>"')} ${dim('for one-shot agent mode.')}`,
    `  ${dim('Run')} ${cyan('mindos <command> --help')} ${dim('for details on any command.')}`,
  );

  if (!showAll) {
    lines.push(`  ${dim('Run')} ${cyan('mindos --all')} ${dim('to see all commands.')}`);
  }

  lines.push('');
  console.log(lines.join('\n'));
}

function showCommandHelp(mod) {
  if (typeof mod.printHelp === 'function') {
    mod.printHelp();
    return;
  }
  printCommandHelp(mod);
}

export async function runMindosCli(argv = process.argv.slice(2)) {
  const { command: cmd, args: cliArgs, flags: cliFlags } = parseArgs(argv);

  if (cliFlags.version || cliFlags.v) {
    console.log(`mindos/${readProductVersion()} node/${process.version} ${process.platform}-${process.arch}`);
    process.exit(0);
  }

  const showAll = cliFlags.all === true || cliFlags.a === true;
  const helpValue = cliFlags.help || cliFlags.h;
  const hasHelp = helpValue !== undefined && helpValue !== false;

  if (showAll && !cmd) {
    await showGlobalHelp(true);
    process.exit(0);
  }

  if (cmd === 'help') {
    const target = cliArgs[0];
    const targetMod = target ? await resolveCommandModule(target) : null;
    if (targetMod) {
      showCommandHelp(targetMod);
    } else {
      await showGlobalHelp(showAll);
    }
    process.exit(0);
  }

  if (hasHelp && typeof helpValue === 'string') {
    const helpMod = await resolveCommandModule(helpValue);
    if (helpMod) {
      showCommandHelp(helpMod);
      process.exit(0);
    }
  }

  const resolvedCmd = hasHelp && !cmd ? null : (cmd || null);
  const mod = resolvedCmd ? await resolveCommandModule(resolvedCmd) : null;

  if (!mod) {
    if (hasHelp) {
      await showGlobalHelp(showAll);
      process.exit(0);
    }

    const agentMod = await agentCmd();
    await agentMod.run(cmd ? [cmd, ...cliArgs] : cliArgs, cliFlags);
    return;
  }

  if (hasHelp) {
    showCommandHelp(mod);
    process.exit(0);
  }

  await mod.run(cliArgs, cliFlags);
}
