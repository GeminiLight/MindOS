/**
 * mindos sync — Cross-device knowledge base sync (git-based).
 *
 * Subcommands: init, now, conflicts, on, off. Default: print status.
 */

import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { EXIT } from '../lib/command.js';

export const meta = {
  name: 'sync',
  group: 'Sync',
  summary: 'Git sync (init/now/conflicts/on/off)',
  usage: 'mindos sync [subcommand]',
  flags: {
    '--remote <url>': 'Git remote URL for init',
    '--token <token>': 'Auth token for private repo',
    '--branch <name>': 'Git branch (default: main)',
    '--json': 'Output as JSON',
  },
  examples: [
    'mindos sync',
    'mindos sync init --remote https://github.com/user/repo.git',
    'mindos sync now',
    'mindos sync conflicts',
    'mindos sync on',
    'mindos sync off',
  ],
};

export const run = async (args, flags) => {
  const sub = args[0];
  loadConfig();
  const mindRoot = process.env.MIND_ROOT;

  const {
    initSync,
    getSyncStatus,
    manualSync,
    listConflicts,
    setSyncEnabled,
    stopSyncDaemon,
  } = await import('../lib/sync.js');

  if (sub === 'init') {
    // Flags are already parsed by parseArgs into flags
    const nonInteractive = flags['non-interactive'] === true;

    if (nonInteractive) {
      await initSync(mindRoot, {
        nonInteractive: true,
        remote: typeof flags.remote === 'string' ? flags.remote : '',
        token: typeof flags.token === 'string' ? flags.token : '',
        branch: (typeof flags.branch === 'string' ? flags.branch : '') || 'main',
      });
    } else {
      await initSync(mindRoot);
    }
    return;
  }

  if (sub === 'now') {
    try {
      console.log(dim('Pulling...'));
      await manualSync(mindRoot);
      console.log(green('✔ Sync complete'));
    } catch (err) {
      console.error(red(err.message));
      process.exit(EXIT.ERROR);
    }
    return;
  }

  if (sub === 'conflicts') {
    await listConflicts(mindRoot);
    return;
  }

  if (sub === 'on') {
    await setSyncEnabled(true);
    return;
  }

  if (sub === 'off') {
    await setSyncEnabled(false);
    await stopSyncDaemon();
    return;
  }

  // Unknown subcommand check
  if (sub) {
    const validSubs = ['init', 'now', 'conflicts', 'on', 'off'];
    if (!validSubs.includes(sub)) {
      console.error(red(`Unknown sync subcommand: ${sub}`));
      console.error(dim(`Available: ${validSubs.join(' | ')}`));
      process.exit(EXIT.ARGS);
    }
  }

  // default: sync status
  const status = await getSyncStatus(mindRoot);

  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (!status.enabled) {
    console.log(`\n${bold('Sync Status')}`);
    console.log(dim('  Not configured. Run `mindos sync init` to set up.\n'));
    return;
  }
  const ago = status.lastSync
    ? (() => {
        const diff = Date.now() - new Date(status.lastSync).getTime();
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
        return `${Math.floor(diff / 3600000)} hours ago`;
      })()
    : 'never';

  console.log(`\n${bold('Sync Status')}`);
  console.log(`  ${dim('Provider:')}    ${cyan(`${status.provider} (${status.remote})`)}`);
  console.log(`  ${dim('Branch:')}      ${cyan(status.branch)}`);
  console.log(`  ${dim('Last sync:')}   ${ago}`);
  console.log(`  ${dim('Unpushed:')}    ${status.unpushed} commits`);
  console.log(`  ${dim('Conflicts:')}   ${status.conflicts.length ? yellow(`${status.conflicts.length} file(s)`) : green('none')}`);
  console.log(`  ${dim('Auto-sync:')}   ${green('● enabled')} ${dim(`(commit: ${status.autoCommitInterval}s, pull: ${status.autoPullInterval / 60}min)`)}`);
  if (status.lastError) {
    console.log(`  ${dim('Last error:')}  ${red(status.lastError)}`);
  }
  console.log();
};
