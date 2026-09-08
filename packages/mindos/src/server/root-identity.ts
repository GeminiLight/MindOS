import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Stable, non-path-revealing identity shared by discovery and guarded writes. */
export function mindRootIdentity(mindRoot: string): string {
  return createHash('sha256').update(resolve(mindRoot)).digest('hex').slice(0, 24);
}
