/**
 * mindos gateway — Manage MindOS as a background OS service
 */

import { bold, dim, cyan } from '../lib/colors.js';

export const meta = {
  name: 'gateway',
  group: 'Gateway',
  summary: 'Manage background service (launchd/systemd)',
  usage: 'mindos gateway <subcommand>',
  examples: [
    'mindos gateway install',
    'mindos gateway start',
    'mindos gateway stop',
    'mindos gateway status',
    'mindos gateway logs',
  ],
};

export const run = async (args) => {
  const sub = args[0];
  if (!sub) {
    const row = (c, d) => `  ${cyan(c.padEnd(32))}${dim(d)}`;
    console.log(`
${bold('mindos gateway')} — manage MindOS as a background OS service

${bold('Subcommands:')}
${row('mindos gateway install',   'Install and enable the service (systemd/launchd)')}
${row('mindos gateway uninstall', 'Disable and remove the service')}
${row('mindos gateway start',     'Start the service')}
${row('mindos gateway stop',      'Stop the service')}
${row('mindos gateway status',    'Show service status')}
${row('mindos gateway logs',      'Tail service logs')}

${dim('Shortcut: mindos start --daemon  →  install + start in one step')}
`);
    return;
  }
  const { runGatewayCommand } = await import('../lib/gateway.js');
  await runGatewayCommand(sub);
};
