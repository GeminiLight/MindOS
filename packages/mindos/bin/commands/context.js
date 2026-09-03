import { existsSync } from 'node:fs';
import { bold, cyan, dim, green } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';

export const meta = {
  name: 'context',
  group: 'Knowledge',
  summary: 'Inspect and teach context recall',
  usage: 'mindos context <feedback|review-stale>',
  examples: [
    'mindos context feedback <receipt-id> helpful --asset <asset-id>',
    'mindos context feedback <receipt-id> missing --expected-path "Projects/Plan.md"',
    'mindos context feedback undo <feedback-id>',
    'mindos context review-stale <asset-id> deprecate --key <idempotency-key>',
  ],
};

export async function run(args, flags) {
  if (!args[0] || args[0] === 'help') {
    printHelp();
    return;
  }
  loadConfig();
  const mindRoot = typeof flags['mind-root'] === 'string' ? flags['mind-root'] : process.env.MIND_ROOT;
  if (!mindRoot || !existsSync(mindRoot)) throw new Error('MindOS mind root is not configured or does not exist.');
  const command = parseContextCommand(args, flags);
  const knowledge = await import('../../dist/knowledge.js');
  let result;
  if (command.action === 'submit') result = knowledge.submitContextFeedback(mindRoot, command);
  else if (command.action === 'retract') result = knowledge.retractContextFeedback(mindRoot, command.feedbackId);
  else result = knowledge.reviewStaleContextAsset(mindRoot, command);

  if (flags.json) console.log(JSON.stringify(result));
  else console.log(green(command.action === 'review-stale' ? 'Context asset review saved.' : 'Context feedback saved.'));
}

export function parseContextCommand(args, flags) {
  if (args[0] === 'feedback' && args[1] === 'undo') {
    const feedbackId = text(args[2]);
    if (!feedbackId) throw new Error('context feedback undo requires a feedback id.');
    return { action: 'retract', feedbackId };
  }
  if (args[0] === 'feedback') {
    const receiptId = text(args[1]);
    const signal = text(args[2]);
    if (!receiptId) throw new Error('context feedback requires a receipt id.');
    if (!['helpful', 'irrelevant', 'stale', 'missing'].includes(signal)) {
      throw new Error('context feedback signal must be helpful, irrelevant, stale, or missing.');
    }
    const assetId = text(flags.asset);
    if (signal === 'missing' && assetId) throw new Error('missing feedback must not include --asset.');
    if (signal !== 'missing' && !assetId) throw new Error(`${signal} feedback requires --asset.`);
    return {
      action: 'submit',
      receiptId,
      signal,
      ...(assetId ? { assetId } : {}),
      ...(text(flags.note) ? { note: text(flags.note) } : {}),
      ...(text(flags['expected-path']) ? { expectedPath: text(flags['expected-path']) } : {}),
    };
  }
  if (args[0] === 'review-stale') {
    const assetId = text(args[1]);
    const decision = text(args[2]);
    const idempotencyKey = text(flags.key);
    if (!assetId) throw new Error('context review-stale requires an asset id.');
    if (decision !== 'keep' && decision !== 'deprecate') throw new Error('review decision must be keep or deprecate.');
    if (!idempotencyKey) throw new Error('context review-stale requires --key.');
    return {
      action: 'review-stale',
      assetId,
      decision,
      idempotencyKey,
      ...(text(flags.note) ? { note: text(flags.note) } : {}),
    };
  }
  throw new Error(`Unknown context command: ${text(args[0]) || 'missing'}`);
}

export function printHelp() {
  const row = (command, description) => `  ${cyan(command.padEnd(66))}${dim(description)}`;
  console.log(`
${bold('mindos context')} — inspect and teach context recall

${bold('Commands:')}
${row('mindos context feedback <receipt> helpful --asset <asset>', 'Mark selected context useful')}
${row('mindos context feedback <receipt> irrelevant --asset <asset>', 'Mark selected context irrelevant')}
${row('mindos context feedback <receipt> stale --asset <asset>', 'Request a separate stale review')}
${row('mindos context feedback <receipt> missing', 'Record missing context')}
${row('mindos context feedback undo <feedback-id>', 'Retract a feedback decision')}
${row('mindos context review-stale <asset> <keep|deprecate> --key <key>', 'Apply an explicit stale review')}
`);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
