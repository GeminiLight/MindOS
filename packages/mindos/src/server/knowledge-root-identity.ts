import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';

/** Optimistic-concurrency identity, not an authorization credential. */
export function knowledgeRootIdentity(mindRoot: string): string {
  const canonical = realpathSync(mindRoot);
  const stat = statSync(canonical);
  return createHash('sha256').update(JSON.stringify([canonical, stat.dev, stat.ino]), 'utf8').digest('hex');
}
