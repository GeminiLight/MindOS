#!/usr/bin/env node

/**
 * MindOS CLI — thin router.
 *
 * All command logic lives in bin/commands/*.js.
 * This file only parses args, dispatches commands, and renders global help.
 */

import { readFileSync } from 'node:fs';

import { PRODUCT_PACKAGE_JSON } from './lib/constants.js';
import { bold, dim, cyan } from './lib/colors.js';
import { parseArgs, printCommandHelp } from './lib/command.js';
import {
  MINDOS_ADDITIONAL_COMMANDS,
  MINDOS_CORE_COMMANDS,
  commandEntries,
  createCommandRegistry,
} from '../src/cli.js';

// ── Modular commands ──────────────────────────────────────────────────────────
import * as agentCmd from './commands/agent.js';
import * as askCmd from './commands/ask.js';
import * as fileCmd from './commands/file.js';
import * as spaceCmd from './commands/space.js';
import * as searchCmd from './commands/search.js';
import * as startCmd from './commands/start.js';
import * as devCmd from './commands/dev.js';
import * as stopCmd from './commands/stop.js';
import * as restartCmd from './commands/restart.js';
import * as buildCmd from './commands/build.js';
import * as statusCmd from './commands/status.js';
import * as openCmd from './commands/open.js';
import * as mcpCmd from './commands/mcp-cmd.js';
import * as tokenCmd from './commands/token.js';
import * as syncCmd from './commands/sync-cmd.js';
import * as gatewayCmd from './commands/gateway.js';
import * as onboardCmd from './commands/onboard.js';
import * as configCmd from './commands/config.js';
import * as doctorCmd from './commands/doctor.js';
import * as updateCmd from './commands/update.js';
import * as uninstallCmd from './commands/uninstall.js';
import * as logsCmd from './commands/logs.js';
import * as apiCmd from './commands/api.js';
import * as initSkillsCmd from './commands/init-skills.js';
import * as channelCmd from './commands/channel.js';
import * as feishuWsCmd from './commands/feishu-ws.js';

// ── Command registry ──────────────────────────────────────────────────────────

const modules = [
  agentCmd, askCmd,
  fileCmd, spaceCmd, searchCmd,
  startCmd, devCmd, stopCmd, restartCmd, buildCmd, statusCmd, openCmd,
  mcpCmd, tokenCmd,
  syncCmd,
  gatewayCmd,
  onboardCmd, configCmd, channelCmd, feishuWsCmd, doctorCmd, updateCmd, uninstallCmd, logsCmd, apiCmd,
  initSkillsCmd,
];

const moduleByDisplayName = {
  agent: agentCmd,
  ask: askCmd,
  start: startCmd,
  stop: stopCmd,
  status: statusCmd,
  open: openCmd,
  file: fileCmd,
  space: spaceCmd,
  search: searchCmd,
  mcp: mcpCmd,
  init: onboardCmd,
  config: configCmd,
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

const commands = createCommandRegistry(modules);

// ── Parse args ────────────────────────────────────────────────────────────────

const { command: cmd, args: cliArgs, flags: cliFlags } = parseArgs(process.argv.slice(2));

if (cliFlags.version || cliFlags.v) {
  const version = JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
  console.log(`mindos/${version} node/${process.version} ${process.platform}-${process.arch}`);
  process.exit(0);
}

// ── Help generation ───────────────────────────────────────────────────────────
// Summaries come from each module's meta.summary — single source of truth.
// [displayName, module] — displayName may differ from meta.name (e.g. init → onboard).

const coreEntries = commandEntries(MINDOS_CORE_COMMANDS, moduleByDisplayName);
const additionalEntries = commandEntries(MINDOS_ADDITIONAL_COMMANDS, moduleByDisplayName);

function showGlobalHelp(showAll = false) {
  const pkgVersion = (() => {
    try { return JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version; }
    catch { return '?'; }
  })();
  const row = ([name, mod]) => `  ${cyan(name.padEnd(14))}${dim(mod.meta.summary)}`;

  const lines = [
    '',
    `${bold('MindOS CLI')} ${dim(`v${pkgVersion}`)}`,
    '',
    `${bold('USAGE')}`,
    `  ${cyan('mindos <command> [flags]')}`,
    '',
    `${bold('COMMANDS')}`,
    ...coreEntries.map(row),
  ];

  if (showAll) {
    lines.push('', `${bold('ADDITIONAL COMMANDS')}`);
    lines.push(...additionalEntries.map(row));
  }

  const flagRow = (f, d) => `  ${cyan(f.padEnd(14))}${dim(d)}`;
  lines.push(
    '',
    `${bold('FLAGS')}`,
    flagRow('--help, -h', 'Show help'),
    flagRow('--version, -v', 'Show version'),
    flagRow('--json', 'Output as JSON'),
    '',
    `  ${dim('Run')} ${cyan('mindos <command> --help')} ${dim('for details on any command.')}`,
  );

  if (!showAll) {
    lines.push(`  ${dim('Run')} ${cyan('mindos --all')} ${dim('to see all commands.')}`);
  }

  lines.push('');
  console.log(lines.join('\n'));
}

/**
 * Show help for a specific command.
 * Delegates to the command's own printHelp() if it exists,
 * otherwise auto-generates from meta.
 */
function showCommandHelp(mod) {
  if (typeof mod.printHelp === 'function') {
    mod.printHelp();
  } else {
    printCommandHelp(mod);
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const showAll = cliFlags.all === true || cliFlags.a === true;

// --help can be boolean (--help) or string (--help agent)
const helpValue = cliFlags.help || cliFlags.h;
const hasHelp = helpValue !== undefined && helpValue !== false;

// `mindos --all` → show full help
if (showAll && !cmd) {
  showGlobalHelp(true);
  process.exit(0);
}

// `mindos help <cmd>` → show help for <cmd>
if (cmd === 'help') {
  const target = cliArgs[0];
  if (target && commands[target]) {
    showCommandHelp(commands[target]);
  } else {
    showGlobalHelp(showAll);
  }
  process.exit(0);
}

// `mindos --help <cmd>` → parseArgs puts <cmd> as the value of --help
if (hasHelp && typeof helpValue === 'string' && commands[helpValue]) {
  showCommandHelp(commands[helpValue]);
  process.exit(0);
}

// Resolve which command to run (or show global help)
const resolvedCmd = (hasHelp && !cmd) ? null : (cmd || null);

if (!resolvedCmd || !commands[resolvedCmd]) {
  showGlobalHelp(showAll);
  process.exit((cmd && !hasHelp) ? 1 : 0);
}

// `mindos <cmd> --help` → show help for <cmd> instead of executing it
if (hasHelp) {
  showCommandHelp(commands[resolvedCmd]);
  process.exit(0);
}

commands[resolvedCmd].run(cliArgs, cliFlags);
