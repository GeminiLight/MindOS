/**
 * Path expansion — resolve `~/...` to absolute paths.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';

export const expandHome = (p) =>
  p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
