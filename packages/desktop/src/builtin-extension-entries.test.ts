import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

/*
 * The runtime health contract must check each built-in Pi extension at the
 * entry the package itself declares.
 *
 * pi-subagents 0.87 moved its entry from TypeScript source
 * (`src/extension/index.ts`) to a prebuilt `bundle/index.js`, named in its
 * `pi.extensions` manifest field. The Web app followed (subagent-extension-entry.ts);
 * the contract did not. Because the contract is read both when packaging and,
 * on users' machines, when judging whether a runtime is healthy, the stale path
 * broke the desktop build *and* would have marked good runtimes as bad.
 *
 * These read the installed packages, so an upstream layout change fails here,
 * in a test, instead of in a release.
 */

const repo = path.resolve(__dirname, '..', '..', '..');
const webNodeModules = path.join(repo, 'packages/web/node_modules');
const STANDALONE_NODE_MODULES = 'packages/web/.next/standalone/node_modules/';

const BUILTIN_EXTENSIONS = [
  '@juicesharp/rpiv-ask-user-question',
  'pi-mcp-adapter',
  'pi-schedule-prompt',
  'pi-subagents',
  'pi-web-access',
] as const;

type Contract = { features: Record<string, { files: Array<{ path: string; type: string }> }> };
const contract: Contract = JSON.parse(readFileSync(path.join(__dirname, '..', 'runtime-health-contract.json'), 'utf-8'));
const contractPaths = Object.values(contract.features).flatMap((f) => f.files.map((e) => e.path));

/** The package's own `pi.extensions[0]`, resolved to the file Pi will load. */
function declaredEntry(pkg: string): string {
  const dir = path.join(webNodeModules, pkg);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  const ext = manifest.pi?.extensions;
  const first = (Array.isArray(ext) ? ext[0] : ext) as string | undefined;
  if (!first) throw new Error(`${pkg} declares no pi.extensions entry`);
  let abs = path.resolve(dir, first);
  // A directory entry means "load its index", as Pi does.
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const index = ['index.js', 'index.ts'].map((f) => path.join(abs, f)).find(existsSync);
    if (index) abs = index;
  }
  return path.relative(dir, abs).split(path.sep).join('/');
}

describe('built-in extension entries in the runtime health contract', () => {
  for (const pkg of BUILTIN_EXTENSIONS) {
    it(`checks ${pkg} at the entry it declares`, () => {
      const entry = declaredEntry(pkg);
      expect(existsSync(path.join(webNodeModules, pkg, entry)), `${pkg}/${entry} is declared but not installed`).toBe(true);
      expect(contractPaths, `contract should check ${pkg}/${entry}`).toContain(`${STANDALONE_NODE_MODULES}${pkg}/${entry}`);
    });
  }

  it('checks no extension file the package does not ship', () => {
    // A path that used to exist and no longer does is exactly the failure mode.
    const extensionPaths = contractPaths.filter((p) =>
      BUILTIN_EXTENSIONS.some((pkg) => p.startsWith(`${STANDALONE_NODE_MODULES}${pkg}/`)));
    const missing = extensionPaths.filter((p) => !existsSync(path.join(webNodeModules, p.slice(STANDALONE_NODE_MODULES.length))));
    expect(missing).toEqual([]);
  });

  it('keeps the packaging scripts on the same entries as the contract', () => {
    // These two scripts carry their own copies of the list.
    const verify = readFileSync(path.join(repo, 'scripts/verify-desktop-runtime.mjs'), 'utf-8');
    const prune = readFileSync(path.join(repo, 'scripts/prune-standalone-extraction.mjs'), 'utf-8');
    for (const source of [verify, prune]) {
      expect(source).not.toContain('src/extension/index.ts');
      expect(source).not.toMatch(/'pi-subagents', 'src', 'extension'/);
    }
    expect(verify).toContain(`${STANDALONE_NODE_MODULES}pi-subagents/${declaredEntry('pi-subagents')}`);
    expect(verify).toContain(`${STANDALONE_NODE_MODULES}pi-web-access/${declaredEntry('pi-web-access')}`);
  });
});
