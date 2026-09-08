/**
 * Path expansion — resolve `~`, `~/...` or `~\...` to absolute paths.
 *
 * JS mirror of `expandHome` in
 * `packages/mindos/src/foundation/shared/utils/path.ts` (the source of truth);
 * bin/lib cannot import from dist/, so keep the two in sync.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';

export const expandHome = (p, homeDir = homedir()) => {
  if (p === '~') return homeDir;
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homeDir, p.slice(2));
  return p;
};
