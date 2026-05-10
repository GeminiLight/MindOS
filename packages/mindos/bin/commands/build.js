/**
 * mindos build — Build for production
 */

import { resolve } from 'node:path';
import { ROOT, WEB_APP_DIR } from '../lib/constants.js';
import { ensureAppDeps, cleanNextDir, writeBuildStamp } from '../lib/build.js';
import { execInheritedFile } from '../lib/shell.js';

const NEXT_CLI = resolve(WEB_APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

export const meta = {
  name: 'build',
  group: 'Service',
  summary: 'Build for production',
  usage: 'mindos build',
};

export const run = (args) => {
  ensureAppDeps({ force: true });
  cleanNextDir();
  execInheritedFile(process.execPath, [resolve(ROOT, 'scripts/gen-renderer-index.js')], ROOT);
  execInheritedFile(process.execPath, [NEXT_CLI, 'build', '--webpack', ...args], WEB_APP_DIR, {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '),
  });
  writeBuildStamp();
};
