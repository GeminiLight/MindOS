import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'package.json'), 'utf-8')).version;

let tempDir: string;
let fakeBinDir: string;
let fakeHome: string;
let fakeInstallRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-update-root-'));
  fakeBinDir = path.join(tempDir, 'fake-bin');
  fakeHome = path.join(tempDir, 'home');
  fakeInstallRoot = path.join(tempDir, 'new-root');

  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.mkdirSync(path.join(fakeHome, '.mindos'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, 'packages', 'web', '.next'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, '_standalone'), { recursive: true });

  fs.writeFileSync(
    path.join(fakeBinDir, 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(path.join(tempDir, 'npm-argv.txt'))}\nexit 0\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.symlinkSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), path.join(fakeBinDir, 'mindos'));
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'package.json'),
    JSON.stringify({ name: '@geminilight/mindos', version: '9.9.9' }),
  );
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'packages', 'web', '.next', '.mindos-build-version'),
    '9.9.9',
  );
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'packages', 'web', 'package.json'),
    JSON.stringify({ name: '@mindos/web', version: '0.1.0' }),
  );
  fs.writeFileSync(path.join(fakeInstallRoot, '_standalone', 'server.js'), '');
  fs.writeFileSync(path.join(fakeInstallRoot, '_standalone', '.mindos-build-version'), '9.9.9');
  fs.writeFileSync(
    path.join(fakeHome, '.mindos', 'config.json'),
    JSON.stringify({ port: 19876, mcpPort: 19877 }),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function runUpdate(extraImports: string[] = [], pathPrefix = fakeBinDir): string {
  try {
    return execFileSync(process.execPath, [
      ...extraImports.flatMap(file => ['--import', file]),
      '--import', path.join(__dirname, 'fixtures/cli-no-host-services.mjs'), CLI, 'update',
    ], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: fakeHome, NODE_ENV: 'test', PATH: `${pathPrefix}${path.delimiter}${process.env.PATH ?? ''}` },
    });
  } catch (error) {
    const failure = error as { code?: string; stdout?: string; stderr?: string };
    let stage = 'not written';
    try { stage = JSON.parse(fs.readFileSync(path.join(fakeHome, '.mindos/update-status.json'), 'utf8')).stage; } catch { /* Failure can precede the first status write. */ }
    throw new Error(`Update fixture failed (${failure.code ?? 'nonzero exit'}), stage=${stage}\nstdout: ${String(failure.stdout ?? '').slice(-2000)}\nstderr: ${String(failure.stderr ?? '').slice(-2000)}`, { cause: error });
  }
}

describe('mindos update root resolution', () => {
  it('resolves the installed root without loading real host-service boundaries', () => {
    const stdout = runUpdate([path.join(__dirname, 'fixtures/cli-host-service-guard.mjs')]);
    expect(stdout).toContain(`Updated: ${CURRENT_VERSION} → 9.9.9`);
  });

  it('reports the failed update stage and stderr instead of hiding subprocess diagnostics', () => {
    fs.writeFileSync(path.join(fakeBinDir, 'npm'), '#!/bin/sh\necho fixture-install-failed >&2\nexit 7\n', { mode: 0o755 });
    expect(() => runUpdate()).toThrow(/stage=failed[\s\S]*fixture-install-failed/);
  });

  it('uses argv command lookup instead of shell strings when finding mindos binaries', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'commands', 'update.js'), 'utf-8');

    expect(source).toContain("execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mindos']");
    expect(source).not.toContain("'where mindos'");
    expect(source).not.toContain("'which mindos'");
  });

  it('runs update subprocesses with argv APIs instead of shell strings', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'commands', 'update.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("execFileSync(invocation.command, invocation.args");
    expect(source).toContain("execFileSync('systemctl', ['--user', 'is-active', 'mindos']");
    expect(source).toContain("execFileSync('id', ['-u']");
    expect(source).toContain("execFileSync('launchctl', ['print', `gui/${uid}/com.mindos.app`]");
  });

  it('uses the resolved installed CLI path instead of falling back to the current repo root', () => {
    const stdout = runUpdate();

    expect(stdout).toContain(`Updated: ${CURRENT_VERSION} → 9.9.9`);
    expect(stdout).not.toContain('Already on the latest version');
    expect(fs.readFileSync(path.join(tempDir, 'npm-argv.txt'), 'utf-8').trim().split(/\r?\n/)).toEqual([
      'install',
      '-g',
      '@geminilight/mindos@latest',
    ]);
  });

  it('uses the resolved installed shim path for the split main package and platform runtime layout', () => {
    fs.rmSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), { force: true });
    fs.rmSync(path.join(fakeInstallRoot, 'packages'), { recursive: true, force: true });
    fs.rmSync(path.join(fakeInstallRoot, '_standalone'), { recursive: true, force: true });
    fs.writeFileSync(path.join(fakeInstallRoot, 'bin', 'mindos-shim.cjs'), '#!/usr/bin/env node\nprocess.exit(0)\n', { mode: 0o755 });
    try { fs.unlinkSync(path.join(fakeBinDir, 'mindos')); } catch {}
    fs.symlinkSync(path.join(fakeInstallRoot, 'bin', 'mindos-shim.cjs'), path.join(fakeBinDir, 'mindos'));

    const stdout = runUpdate();

    expect(stdout).toContain(`Updated: ${CURRENT_VERSION} → 9.9.9`);
    expect(stdout).not.toContain('Building MindOS');
  });

  it('skips the shell shim under ~/.mindos/bin/ and falls back to current ROOT', () => {
    const shimDir = path.join(fakeHome, '.mindos', 'bin');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(
      path.join(shimDir, 'mindos'),
      '#!/bin/sh\nexec node "$(dirname "$0")/../cli.js" "$@"\n',
      { mode: 0o755 },
    );

    const stdout = runUpdate([], `${shimDir}${path.delimiter}${fakeBinDir}`);

    // `which mindos` finds shimDir/mindos first, but getUpdatedRoot() skips it
    // (dirname matches $HOME/.mindos/bin). Falls back to ROOT where
    // package.json has CURRENT_VERSION → reports "already on the latest".
    expect(stdout).toContain('Already on the latest version');
  });
});
