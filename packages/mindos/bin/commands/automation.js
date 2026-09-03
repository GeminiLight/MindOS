import { existsSync } from 'node:fs';
import { bold, cyan, dim, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';

export const meta = {
  name: 'automation',
  group: 'Service',
  summary: 'Run and manage the independent Automation executor',
  usage: 'mindos automation <once|worker|emit|service>',
  examples: [
    'mindos automation once',
    'mindos automation worker',
    'mindos automation emit knowledge.changed --source knowledge --key change-42 --payload \'{"path":"notes/plan.md"}\'',
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
  if (subcommand !== 'once' && subcommand !== 'worker' && subcommand !== 'emit') {
    throw new Error(`Unknown automation command: ${subcommand}`);
  }

  loadConfig();
  const mindRoot = typeof flags['mind-root'] === 'string' ? flags['mind-root'] : process.env.MIND_ROOT;
  if (!mindRoot || !existsSync(mindRoot)) {
    console.error(red('MindOS mind root is not configured or does not exist.'));
    process.exitCode = 2;
    return;
  }
  const server = await import('../../dist/server.js');
  if (subcommand === 'emit') {
    const request = parseAutomationEmitRequest(args.slice(1), flags);
    const result = server.emitStudioAutomationEvent(mindRoot, request);
    if (flags.json) console.log(JSON.stringify(result));
    else if (result.created) console.log(dim(`Automation event queued: ${result.event.id}`));
    else console.log(dim(`Automation event already received: ${result.event.id}`));
    return;
  }

  const {
    createStudioAutomationExecutor,
    runStudioAutomationWorkerOnce,
    runStudioAutomationWorkerService,
  } = server;
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

export function parseAutomationEmitRequest(args, flags) {
  const type = typeof args[0] === 'string' ? args[0].trim() : '';
  const source = typeof flags.source === 'string' ? flags.source.trim() : '';
  const key = typeof flags.key === 'string' ? flags.key.trim() : '';
  if (!type) throw new Error('automation emit requires an event type.');
  if (!source) throw new Error('automation emit requires --source.');
  if (!key) throw new Error('automation emit requires --key.');

  let payload = {};
  if (flags.payload !== undefined) {
    if (typeof flags.payload !== 'string') throw new Error('--payload must be a valid JSON object.');
    try {
      payload = JSON.parse(flags.payload);
    } catch {
      throw new Error('--payload must be valid JSON.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('--payload must be a JSON object.');
    }
  }

  let occurredAt;
  if (flags['occurred-at'] !== undefined) {
    if (typeof flags['occurred-at'] !== 'string' || !Number.isFinite(Date.parse(flags['occurred-at']))) {
      throw new Error('--occurred-at must be an ISO timestamp.');
    }
    occurredAt = new Date(flags['occurred-at']);
  }
  return { source, key, type, payload, ...(occurredAt ? { occurredAt } : {}) };
}

export function printHelp() {
  const row = (command, description) => `  ${cyan(command.padEnd(43))}${dim(description)}`;
  console.log(`
${bold('mindos automation')} — independent durable Automation executor

${bold('Commands:')}
${row('mindos automation once', 'Run one queue tick and exit')}
${row('mindos automation worker', 'Run the foreground resident worker')}
${row('mindos automation emit <type> --source <source> --key <key>', 'Queue one idempotent event')}
${row('mindos automation service install', 'Install and start the OS user service')}
${row('mindos automation service start', 'Start the installed service')}
${row('mindos automation service stop', 'Stop the service')}
${row('mindos automation service status', 'Show service status')}
${row('mindos automation service logs', 'Follow executor logs')}
${row('mindos automation service uninstall', 'Stop and remove the service')}
`);
}
