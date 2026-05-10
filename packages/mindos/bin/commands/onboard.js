/**
 * mindos onboard — Interactive setup wizard
 */

import { resolve } from 'node:path';
import { ROOT } from '../lib/constants.js';
import { execInheritedFile } from '../lib/shell.js';

export const meta = {
  name: 'onboard',
  aliases: ['init', 'setup'],
  group: 'Config',
  summary: 'First-time setup wizard',
  usage: 'mindos onboard',
  examples: [
    'mindos onboard',
    'mindos init',
    'mindos setup',
  ],
};

export const run = (args, flags) => {
  const setupArgs = [resolve(ROOT, 'scripts/setup.js')];
  if (flags['install-daemon']) setupArgs.push('--install-daemon');
  execInheritedFile(process.execPath, setupArgs);
};
