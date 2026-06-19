import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  findBuiltinWebRuntimePackagePath,
  getBuiltinWebRuntimePackageDirCandidates,
  getMindosWebRuntimeSourceDirCandidates,
  resolveMindosWebRuntimeSourcePath,
  resolveBuiltinWebRuntimePackagePath,
} from '../../lib/agent/builtin-extension-runtime';

const created: string[] = [];

function makeTemp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeFile(filePath: string, content = '') {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
  while (created.length) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('builtin extension runtime package resolution', () => {
  it('prefers standalone node_modules over app-level node_modules', () => {
    const appDir = makeTemp('mindos-web-runtime-app-');
    const standaloneEntry = path.join(appDir, '.next', 'standalone', 'node_modules', 'pi-web-access', 'index.ts');
    const devEntry = path.join(appDir, 'node_modules', 'pi-web-access', 'index.ts');
    writeFile(standaloneEntry, 'standalone');
    writeFile(devEntry, 'dev');

    expect(resolveBuiltinWebRuntimePackagePath(appDir, 'pi-web-access', 'index.ts')).toBe(realpathSync(standaloneEntry));
  });

  it('falls back to app-level node_modules in dev/source layouts', () => {
    const appDir = makeTemp('mindos-web-runtime-dev-');
    const devEntry = path.join(appDir, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
    writeFile(devEntry, 'dev');

    expect(findBuiltinWebRuntimePackagePath(appDir, 'pi-subagents', 'src', 'extension', 'index.ts')).toBe(realpathSync(devEntry));
  });

  it('includes publishable standalone __node_modules for npm package layouts', () => {
    const cwd = process.cwd();
    const standaloneRoot = makeTemp('mindos-web-runtime-standalone-');
    const publishableEntry = path.join(standaloneRoot, '__node_modules', 'pi-schedule-prompt', 'src', 'tool.ts');
    writeFile(publishableEntry, 'tool');

    try {
      process.chdir(standaloneRoot);
      const resolvedStandaloneRoot = realpathSync(standaloneRoot);
      expect(getBuiltinWebRuntimePackageDirCandidates(undefined, 'pi-schedule-prompt')).toContain(
        path.join(resolvedStandaloneRoot, '__node_modules', 'pi-schedule-prompt'),
      );
      expect(resolveBuiltinWebRuntimePackagePath(undefined, 'pi-schedule-prompt', 'src', 'tool.ts')).toBe(
        realpathSync(publishableEntry),
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it('resolves MindOS extension wrapper sources from dev and standalone layouts', () => {
    const appDir = makeTemp('mindos-web-runtime-source-app-');
    const standaloneEntry = path.join(appDir, '.next', 'standalone', 'lib', 'agent', 'subagent-ledger-extension.ts');
    const devEntry = path.join(appDir, 'lib', 'agent', 'subagent-ledger-extension.ts');
    writeFile(standaloneEntry, 'standalone');
    writeFile(devEntry, 'dev');

    expect(resolveMindosWebRuntimeSourcePath(appDir, 'lib', 'agent', 'subagent-ledger-extension.ts')).toBe(
      realpathSync(devEntry),
    );
    rmSync(path.join(appDir, 'lib'), { recursive: true, force: true });
    expect(resolveMindosWebRuntimeSourcePath(appDir, 'lib', 'agent', 'subagent-ledger-extension.ts')).toBe(
      realpathSync(standaloneEntry),
    );

    const packagedRoot = makeTemp('mindos-web-runtime-source-packaged-');
    const packagedEntry = path.join(packagedRoot, 'lib', 'schedule-prompt', 'index.ts');
    writeFile(packagedEntry, 'packaged');
    const cwd = process.cwd();
    try {
      process.chdir(packagedRoot);
      expect(getMindosWebRuntimeSourceDirCandidates(undefined)).toContain(realpathSync(packagedRoot));
      expect(resolveMindosWebRuntimeSourcePath(undefined, 'lib', 'schedule-prompt', 'index.ts')).toBe(
        realpathSync(packagedEntry),
      );
    } finally {
      process.chdir(cwd);
    }
  });
});
