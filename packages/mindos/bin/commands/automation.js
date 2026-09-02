import { existsSync } from 'node:fs';
import { bold, cyan, dim, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';

export const meta = {
  name: 'automation',
  group: 'Service',
  summary: 'Run and manage the independent Automation executor',
  usage: 'mindos automation <once|worker|service>',
  examples: [
    'mindos automation once',
    'mindos automation worker',
    'mindos automation service install',
    'mindos automation service status',
  ],
};

export async function run(args, flags) {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help') {
    printHelp();
    return;
  }
  if (subcommand === 'service') {
    const action = args[1];
    if (!action) {
      printHelp();
      return;
    }
    const { runAutomationServiceCommand } = await import('../lib/automation-service.js');
    await runAutomationServiceCommand(action);
    return;
  }
  if (subcommand !== 'once' && subcommand !== 'worker') {
    throw new Error(`Unknown automation command: ${subcommand}`);
  }

  loadConfig();
  const mindRoot = typeof flags['mind-root'] === 'string' ? flags['mind-root'] : process.env.MIND_ROOT;
  if (!mindRoot || !existsSync(mindRoot)) {
    console.error(red('MindOS mind root is not configured or does not exist.'));
    process.exitCode = 2;
    return;
  }
  const {
    createStudioAutomationExecutor,
    runStudioAutomationWorkerOnce,
    runStudioAutomationWorkerService,
  } = await import('../../dist/server.js');
  const executor = createStudioAutomationExecutor({ mindRoot });
  if (subcommand === 'once') {
    const result = await runStudioAutomationWorkerOnce({ mindRoot, executor });
    if (flags.json) console.log(JSON.stringify(result));
    else console.log(dim(`Automation tick complete: ${result.completed} completed, ${result.failed} failed.`));
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runStudioAutomationWorkerService({ mindRoot, executor, signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

export function printHelp() {
  const row = (command, description) => `  ${cyan(command.padEnd(43))}${dim(description)}`;
  console.log(`
${bold('mindos automation')} — independent durable Automation executor

${bold('Commands:')}
${row('mindos automation once', 'Run one queue tick and exit')}
${row('mindos automation worker', 'Run the foreground resident worker')}
${row('mindos automation service install', 'Install and start the OS user service')}
${row('mindos automation service start', 'Start the installed service')}
${row('mindos automation service stop', 'Stop the service')}
${row('mindos automation service status', 'Show service status')}
${row('mindos automation service logs', 'Follow executor logs')}
${row('mindos automation service uninstall', 'Stop and remove the service')}
`);
}
