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

import * as agentCmd from '../bin/commands/agent.js';
import * as askCmd from '../bin/commands/ask.js';
import * as fileCmd from '../bin/commands/file.js';
import * as spaceCmd from '../bin/commands/space.js';
import * as searchCmd from '../bin/commands/search.js';
import * as startCmd from '../bin/commands/start.js';
import * as devCmd from '../bin/commands/dev.js';
import * as stopCmd from '../bin/commands/stop.js';
import * as restartCmd from '../bin/commands/restart.js';
import * as buildCmd from '../bin/commands/build.js';
import * as statusCmd from '../bin/commands/status.js';
import * as openCmd from '../bin/commands/open.js';
import * as mcpCmd from '../bin/commands/mcp-cmd.js';
import * as tokenCmd from '../bin/commands/token.js';
import * as syncCmd from '../bin/commands/sync-cmd.js';
import * as gatewayCmd from '../bin/commands/gateway.js';
import * as onboardCmd from '../bin/commands/onboard.js';
import * as configCmd from '../bin/commands/config.js';
import * as doctorCmd from '../bin/commands/doctor.js';
import * as updateCmd from '../bin/commands/update.js';
import * as uninstallCmd from '../bin/commands/uninstall.js';
import * as logsCmd from '../bin/commands/logs.js';
import * as apiCmd from '../bin/commands/api.js';
import * as initSkillsCmd from '../bin/commands/init-skills.js';
import * as channelCmd from '../bin/commands/channel.js';
import * as feishuWsCmd from '../bin/commands/feishu-ws.js';

const commandModules = [
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
  channelCmd,
  feishuWsCmd,
  doctorCmd,
  updateCmd,
  uninstallCmd,
  logsCmd,
  apiCmd,
  initSkillsCmd,
];

const moduleByDisplayName = {
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

const commands = createCommandRegistry(commandModules);

function readProductVersion() {
  try {
    return JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
  } catch {
    return '?';
  }
}

function showGlobalHelp(showAll = false) {
  const row = ([name, mod]) => `  ${cyan(name.padEnd(14))}${dim(mod.meta.summary)}`;
  const coreEntries = commandEntries(MINDOS_CORE_COMMANDS, moduleByDisplayName);
  const additionalEntries = commandEntries(MINDOS_ADDITIONAL_COMMANDS, moduleByDisplayName);

  const lines = [
    '',
    `${bold('MindOS CLI')} ${dim(`v${readProductVersion()}`)}`,
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

  const flagRow = (flag, description) => `  ${cyan(flag.padEnd(14))}${dim(description)}`;
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
    showGlobalHelp(true);
    process.exit(0);
  }

  if (cmd === 'help') {
    const target = cliArgs[0];
    if (target && commands[target]) {
      showCommandHelp(commands[target]);
    } else {
      showGlobalHelp(showAll);
    }
    process.exit(0);
  }

  if (hasHelp && typeof helpValue === 'string' && commands[helpValue]) {
    showCommandHelp(commands[helpValue]);
    process.exit(0);
  }

  const resolvedCmd = hasHelp && !cmd ? null : (cmd || null);

  if (!resolvedCmd || !commands[resolvedCmd]) {
    showGlobalHelp(showAll);
    process.exit(cmd && !hasHelp ? 1 : 0);
  }

  if (hasHelp) {
    showCommandHelp(commands[resolvedCmd]);
    process.exit(0);
  }

  await commands[resolvedCmd].run(cliArgs, cliFlags);
}
