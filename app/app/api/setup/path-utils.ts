import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function expandSetupPathHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
}
