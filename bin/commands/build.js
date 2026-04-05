/**
 * mindos build — Build for production
 */

import { resolve } from 'node:path';
import { ROOT } from '../lib/constants.js';
import { ensureAppDeps, cleanNextDir, writeBuildStamp } from '../lib/build.js';
import { execInherited } from '../lib/shell.js';

const NEXT_BIN = resolve(ROOT, 'app', 'node_modules', '.bin', 'next');

export const meta = {
  name: 'build',
  group: 'Service',
  summary: 'Build for production',
  usage: 'mindos build',
};

export const run = (args) => {
  const extra = args.join(' ');
  ensureAppDeps({ force: true });
  cleanNextDir();
  execInherited('node scripts/gen-renderer-index.js', ROOT);
  execInherited(`${NEXT_BIN} build --webpack ${extra}`, resolve(ROOT, 'app'));
  writeBuildStamp();
};
