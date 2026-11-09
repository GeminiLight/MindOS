import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { privateCheckout } from './helpers/private-checkout';

/*
 * The public mirror must be installable on its own.
 *
 * pnpm-workspace.yaml started referencing patches/pi-schedule-prompt@0.4.1.patch,
 * but `patches/` was not in .syncinclude. The next sync shipped a workspace that
 * pointed at a file the mirror did not have, and `pnpm install` failed on every
 * platform there — before a single test or build could run.
 *
 * These read the same whitelist the sync workflow reads (scripts/parse-syncinclude.sh)
 * and check that every file the install depends on would actually be published.
 */

const root = path.resolve(__dirname, '..');

function syncedPaths(): { dirs: string[]; files: string[] } {
  const out = execFileSync('bash', [path.join(root, 'scripts/parse-syncinclude.sh')], { encoding: 'utf-8' });
  const grab = (name: string) => {
    const m = out.match(new RegExp(`^${name}=["']?(.*?)["']?$`, 'm'));
    return m ? m[1].split(/\s+/).filter(Boolean) : [];
  };
  return { dirs: grab('SYNC_DIRS'), files: grab('ROOT_FILES') };
}

function isSynced(rel: string, synced: { dirs: string[]; files: string[] }): boolean {
  const normalized = rel.replace(/^\.\//, '');
  if (!normalized.includes('/')) return synced.files.includes(normalized);
  return synced.dirs.includes(normalized.split('/')[0]);
}

/** Patch paths from pnpm-workspace.yaml's `patchedDependencies:` block. */
function workspacePatchPaths(): string[] {
  const yaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf-8');
  const block = yaml.match(/^patchedDependencies:\n((?:[ \t]+.*\n?)*)/m);
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((line) => line.match(/:\s*['"]?([^'"\s]+)['"]?\s*$/)?.[1])
    .filter((p): p is string => Boolean(p));
}

/** Patch paths from package.json's `pnpm.patchedDependencies`, the older location. */
function manifestPatchPaths(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
  return Object.values<string>(pkg.pnpm?.patchedDependencies ?? {});
}

// .syncinclude itself is private, so this can only run in mindos-dev.
describe.skipIf(!privateCheckout)('public mirror is installable', () => {
  const synced = privateCheckout ? syncedPaths() : { dirs: [], files: [] };

  it('can read the whitelist the sync workflow uses', () => {
    // Guards the helpers above: an empty parse would make every check pass.
    expect(synced.dirs).toContain('packages');
    expect(synced.files).toContain('pnpm-workspace.yaml');
  });

  const patches = privateCheckout ? [...workspacePatchPaths(), ...manifestPatchPaths()] : [];

  it('finds the dependency patches it is meant to check', () => {
    expect(patches.length).toBeGreaterThan(0);
  });

  for (const patch of patches) {
    it(`publishes ${patch}`, () => {
      expect(existsSync(path.join(root, patch)), `${patch} is referenced but missing in mindos-dev`).toBe(true);
      expect(isSynced(patch, synced), `${patch} is referenced by the workspace but excluded by .syncinclude`).toBe(true);
    });
  }

  it('publishes the files pnpm reads to resolve the workspace', () => {
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      expect(isSynced(file, synced), file).toBe(true);
    }
  });
});
