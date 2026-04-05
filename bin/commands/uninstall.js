/**
 * mindos uninstall — interactive teardown: stop processes, remove daemon, optional config/KB, npm uninstall.
 *
 * Uses dynamic import for readline and gateway to limit upfront module cost.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

import { CONFIG_PATH, MINDOS_DIR } from '../lib/constants.js';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { stopMindos } from '../lib/stop.js';

export const meta = {
  name: 'uninstall',
  group: 'Config',
  summary: 'Fully uninstall MindOS',
  usage: 'mindos uninstall',
};

export const run = async () => {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Buffer lines eagerly — readline.question() loses buffered lines when
  // piped stdin delivers multiple lines at once (Node.js known behavior).
  const lineBuffer = [];
  let lineResolve = null;
  rl.on('line', (line) => {
    if (lineResolve) {
      const r = lineResolve;
      lineResolve = null;
      r(line);
    } else {
      lineBuffer.push(line);
    }
  });
  // On EOF with no pending resolve, close gracefully
  rl.on('close', () => {
    if (lineResolve) { lineResolve(''); lineResolve = null; }
  });

  function prompt(question) {
    process.stdout.write(question + ' ');
    if (lineBuffer.length > 0) return Promise.resolve(lineBuffer.shift());
    return new Promise((resolve) => { lineResolve = resolve; });
  }

  async function confirm(question) {
    const a = (await prompt(question + ' [y/N]')).trim().toLowerCase();
    return a === 'y' || a === 'yes';
  }

  async function askInput(question) {
    return (await prompt(question)).trim();
  }

  async function askPassword(question) {
    // Mute echoed keystrokes
    const stdout = process.stdout;
    const origWrite = stdout.write.bind(stdout);
    stdout.write = (chunk, ...args) => {
      // Suppress everything except the prompt itself
      if (typeof chunk === 'string' && chunk.includes(question)) return origWrite(chunk, ...args);
      return true;
    };
    const answer = await prompt(question);
    stdout.write = origWrite;
    console.log(); // newline after hidden input
    return answer.trim();
  }

  const done = () => rl.close();

  console.log(`\n${bold('🗑  MindOS Uninstall')}\n`);
  console.log('  This will:');
  console.log(`  ${green('✓')} Stop running MindOS processes`);
  console.log(`  ${green('✓')} Remove background service (if installed)`);
  console.log(`  ${green('✓')} Uninstall npm package\n`);

  if (!await confirm('Proceed?')) {
    console.log(dim('\n  Aborted.\n'));
    done();
    return;
  }

  // 1. Stop processes
  console.log(`\n${cyan('Stopping MindOS...')}`);
  try { stopMindos(); } catch { /* may not be running */ }

  // 2. Remove daemon (skip if platform unsupported)
  const gateway = await import('../lib/gateway.js');
  if (await gateway.getPlatform()) {
    try {
      await gateway.runGatewayCommand('uninstall');
    } catch {
      // Daemon may not be installed — that's fine
    }
  }

  // Read config before potentially deleting ~/.mindos/
  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  const mindRoot = config.mindRoot?.replace(/^~/, homedir());

  // 3. Ask to remove ~/.mindos/
  if (existsSync(MINDOS_DIR)) {
    if (await confirm(`Remove config directory (${dim(MINDOS_DIR)})?`)) {
      rmSync(MINDOS_DIR, { recursive: true, force: true });
      console.log(`${green('✔')} Removed ${dim(MINDOS_DIR)}`);
    } else {
      console.log(dim(`  Kept ${MINDOS_DIR}`));
    }
  }

  // 4. Ask to remove knowledge base (triple protection: confirm → type YES → password)
  if (mindRoot && existsSync(mindRoot)) {
    if (await confirm(`Remove knowledge base (${dim(mindRoot)})?`)) {
      const typed = await askInput(`${yellow('⚠  This is irreversible.')} Type ${bold('YES')} to confirm:`);
      if (typed === 'YES') {
        const webPassword = config.webPassword;
        let authorized = true;
        if (webPassword) {
          const pw = await askPassword('Enter web password:');
          if (pw !== webPassword) {
            console.log(red('  Wrong password. Knowledge base kept.'));
            authorized = false;
          }
        }
        if (authorized) {
          rmSync(mindRoot, { recursive: true, force: true });
          console.log(`${green('✔')} Removed ${dim(mindRoot)}`);
        }
      } else {
        console.log(dim('  Knowledge base kept.'));
      }
    } else {
      console.log(dim(`  Kept ${mindRoot}`));
    }
  }

  // 5. npm uninstall -g
  console.log(`\n${cyan('Uninstalling npm package...')}`);
  try {
    execSync('npm uninstall -g @geminilight/mindos', { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    console.log(yellow('  npm uninstall failed — you may need to run manually:'));
    console.log(dim('  npm uninstall -g @geminilight/mindos'));
  }

  console.log(`\n${green('✔ MindOS uninstalled.')}\n`);
  done();
};
