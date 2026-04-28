/**
 * Path expansion — resolve `~/...` or `~\...` to absolute paths.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';

export const expandHome = (p) => {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
};
