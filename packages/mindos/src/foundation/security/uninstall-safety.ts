import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

function refuse(reason: string): never {
  throw new Error(`Refusing configuration cleanup: ${reason} Keep configuration, or move your knowledge base and verify its setting before trying again.`);
}

function inside(parent: string, target: string): boolean {
  const path = relative(parent, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\'));
}

// Resolve existing ancestors too: a missing vault under an aliased directory
// must not bypass the same guard that protects an existing vault.
function canonicalPath(path: string): string {
  let current = path;
  const suffix: string[] = [];
  for (;;) {
    try {
      lstatSync(current);
      return resolve(realpathSync(current), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // An existing dangling symlink is not a missing directory to guess past.
      try { if (lstatSync(current).isSymbolicLink()) throw new Error('Unresolved symlink'); }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.unshift(basename(current)); current = parent;
    }
  }
}

/** Read fresh filesystem state; never use a cached mind-root resolver for deletion. */
export function assertSafeConfigRemoval(homeDir = homedir(), env: Record<string, string | undefined> = process.env): void {
  const configDir = resolve(homeDir, '.mindos');
  let stat;
  try { stat = lstatSync(configDir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    refuse('the configuration directory cannot be inspected.');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse('the configuration directory is redirected or is not a directory.');

  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(configDir, 'config.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid configuration');
    config = parsed as Record<string, unknown>;
  } catch { refuse('the knowledge-base setting cannot be read reliably.'); }

  // Mirror the uncached resolver's default, while conservatively protecting both
  // persisted and environment roots when either has been explicitly configured.
  const roots = [config.mindRoot, env.MIND_ROOT || undefined];
  if (config.mindRoot === undefined && !env.MIND_ROOT) roots.push(resolve(homeDir, 'MindOS', 'mind'));
  for (const value of roots) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) refuse('the knowledge-base setting is invalid.');
    const raw = value.trim();
    const root = raw.startsWith('~/') || raw.startsWith('~\\') ? resolve(homeDir, raw.slice(2)) : raw;
    if (!isAbsolute(root)) refuse('the knowledge-base setting must be an absolute path.');
    const lexicalRoot = resolve(root);
    let canonicalConfig: string;
    let canonicalRoot: string;
    try {
      canonicalConfig = realpathSync(configDir);
      canonicalRoot = canonicalPath(lexicalRoot);
    } catch { refuse('the knowledge-base path cannot be verified.'); }
    if (inside(configDir, lexicalRoot) || inside(lexicalRoot, configDir)
      || inside(canonicalConfig, canonicalRoot) || inside(canonicalRoot, canonicalConfig)) {
      refuse('the configuration directory overlaps a knowledge base.');
    }
  }
}
