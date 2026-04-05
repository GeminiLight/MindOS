/**
 * mindos logs — Tail service logs
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { LOG_PATH } from '../lib/constants.js';
import { dim } from '../lib/colors.js';

export const meta = {
  name: 'logs',
  group: 'Config',
  summary: 'Tail service logs',
  usage: 'mindos logs',
  examples: [
    'mindos logs',
  ],
};

export const run = async (args, flags) => {
  const { ensureMindosDir } = await import('../lib/gateway.js');
  await ensureMindosDir();

  if (!existsSync(LOG_PATH)) {
    console.log(dim(`No log file yet at ${LOG_PATH}`));
    console.log(dim('Logs are created when starting MindOS (mindos start, mindos onboard, or daemon mode).'));
    process.exit(0);
  }

  const noFollow = flags['no-follow'] === true;
  execSync(noFollow ? `tail -n 100 ${LOG_PATH}` : `tail -f ${LOG_PATH}`, { stdio: 'inherit' });
};
