import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for `mindos uninstall` command.
 *
 * Key invariants:
 * 1. Default answer is N — empty/piped stdin must abort without deleting anything
 * 2. Config is read BEFORE ~/.mindos/ is deleted (ordering bug regression)
 * 3. Knowledge base deletion requires triple protection (confirm → YES → password)
 * 4. Help text lists the uninstall command
 */

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');

let tempHome: string;
let savedHome: string | undefined;
let fakeBinDir: string;
let isolationPreload: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-uninstall-'));
  fakeBinDir = path.join(tempHome, 'fake-bin');
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBinDir, 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(path.join(tempHome, 'npm-argv.txt'))}\nexit 0\n`,
    { mode: 0o755 },
  );
  savedHome = process.env.HOME;
  isolationPreload = path.join(tempHome, 'isolate.cjs');
  fs.writeFileSync(isolationPreload, `
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const os = require('node:os');
    const path = require('node:path');
    const { syncBuiltinESMExports } = require('node:module');
    const fixture = ${JSON.stringify(tempHome)};
    os.homedir = () => fixture;
    const remove = fs.rmSync;
    fs.rmSync = (target, options) => {
      const rel = path.relative(fixture, path.resolve(target));
      if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Test refused deletion outside fixture');
      return remove(target, options);
    };
    cp.execFileSync = (command, args) => {
      if (command === 'id' && args[0] === '-u') return '1000';
      if (command === 'npm' || (command === process.execPath && args[0]?.endsWith('npm-cli.js'))) {
        fs.writeFileSync(path.join(fixture, 'npm-argv.txt'), (command === 'npm' ? args : args.slice(1)).join('\\n'));
        return '';
      }
      if (command === 'launchctl' || command === 'systemctl') {
        fs.writeFileSync(path.join(fixture, 'daemon-called'), command);
        const changed = path.join(fixture, 'config-after-daemon.json');
        if (fs.existsSync(changed)) fs.writeFileSync(path.join(fixture, '.mindos', 'config.json'), fs.readFileSync(changed));
        return '';
      }
      throw new Error('Test refused external command: ' + command);
    };
    syncBuiltinESMExports();
  `);
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function run(
  args: string[],
  opts: { input?: string; home?: string } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const home = opts.home ?? tempHome;
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: home,
        MIND_ROOT: undefined,
        NODE_ENV: 'test',
        NODE_OPTIONS: `--require=${isolationPreload}`,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      input: opts.input ?? '',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status ?? 1,
    };
  }
}

/** Write a minimal config.json in the temp home's .mindos/ */
function writeConfig(
  config: Record<string, unknown>,
  home: string = tempHome,
): void {
  const dir = path.join(home, '.mindos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
}

describe('mindos uninstall — smoke', () => {
  it('aborts on empty enter (default N) and exits 0', () => {
    const { stdout, exitCode } = run(['uninstall'], { input: '\n' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Aborted');
  });

  it('aborts when user types n', () => {
    const { stdout, exitCode } = run(['uninstall'], { input: 'n\n' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Aborted');
  });

  it('shows operation list before asking for confirmation', () => {
    const { stdout } = run(['uninstall'], { input: '\n' });
    expect(stdout).toContain('Stop running MindOS processes');
    expect(stdout).toContain('Remove background service');
    expect(stdout).toContain('Uninstall npm package');
  });

  it('uses argv APIs instead of shell strings for npm uninstall', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'commands', 'uninstall.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("resolveNpmInvocation(['uninstall', '-g', '@geminilight/mindos']");
    expect(source).toContain('execFileSync(invocation.command, invocation.args');
  });

  it('runs npm uninstall with argv args after confirmation', () => {
    const { exitCode } = run(['uninstall'], { input: 'y\nn\n' });

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(path.join(tempHome, 'npm-argv.txt'), 'utf-8').trim().split(/\r?\n/)).toEqual([
      'uninstall',
      '-g',
      '@geminilight/mindos',
    ]);
  });
});

describe('mindos uninstall — help text', () => {
  it('--all lists the uninstall command', () => {
    const { stdout, exitCode } = run(['--all']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('uninstall');
  });
});

describe('mindos uninstall — does not delete on N answers', () => {
  it.each(['same', 'nested', 'alias'])('refuses configuration cleanup when it would remove the %s knowledge base', kind => {
    const configDir = path.join(tempHome, '.mindos');
    fs.mkdirSync(configDir, { recursive: true });
    const stored = kind === 'same' ? configDir : path.join(configDir, '资料 📝');
    fs.mkdirSync(stored, { recursive: true });
    const note = path.join(stored, 'keep.md'); fs.writeFileSync(note, 'irreplaceable');
    let mindRoot = stored;
    if (kind === 'alias') {
      mindRoot = path.join(tempHome, 'notes-alias');
      fs.symlinkSync(stored, mindRoot, process.platform === 'win32' ? 'junction' : 'dir');
    }
    writeConfig({ mindRoot });
    const result = run(['uninstall'], { input: 'y\ny\nn\n' });
    expect(fs.existsSync(note)).toBe(true);
    expect(fs.readFileSync(note, 'utf8')).toBe('irreplaceable');
    expect(result.stdout + result.stderr).toContain('Refusing configuration cleanup');
    expect(fs.existsSync(path.join(tempHome, 'npm-argv.txt'))).toBe(false);
    expect(fs.existsSync(path.join(tempHome, 'daemon-called'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('rechecks a changed configuration after service teardown before removing files', () => {
    const nested = path.join(tempHome, '.mindos', 'notes');
    fs.mkdirSync(nested, { recursive: true });
    const note = path.join(nested, 'keep.md');
    fs.writeFileSync(note, 'irreplaceable');
    writeConfig({ mindRoot: path.join(tempHome, 'separate-notes') });
    fs.writeFileSync(path.join(tempHome, 'config-after-daemon.json'), JSON.stringify({ mindRoot: nested }));
    const result = run(['uninstall'], { input: 'y\ny\nn\n' });
    expect(fs.existsSync(path.join(tempHome, 'daemon-called'))).toBe(true);
    expect(fs.readFileSync(note, 'utf8')).toBe('irreplaceable');
    expect(result.stdout + result.stderr).toContain('Refusing configuration cleanup');
    expect(fs.existsSync(path.join(tempHome, 'npm-argv.txt'))).toBe(false);
  });

  it('does not erase configuration when its knowledge-base location cannot be read', () => {
    fs.mkdirSync(path.join(tempHome, '.mindos'));
    fs.writeFileSync(path.join(tempHome, '.mindos', 'config.json'), '{broken');
    const result = run(['uninstall'], { input: 'y\ny\n' });
    expect(fs.existsSync(path.join(tempHome, '.mindos', 'config.json'))).toBe(true);
    expect(result.stdout + result.stderr).toContain('Refusing configuration cleanup');
  });

  it('keeps ~/.mindos/ when user says Y to proceed but N to remove config', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'test.md'), 'hello');
    writeConfig({ mindRoot });

    // Y to proceed, N to remove config, N to remove knowledge base
    const { stdout } = run(['uninstall'], { input: 'y\nn\nn\n' });
    expect(stdout).toContain('Kept');
    expect(fs.existsSync(path.join(tempHome, '.mindos'))).toBe(true);
    expect(fs.existsSync(mindRoot)).toBe(true);
  });

  it('keeps knowledge base when user says Y to proceed, Y to config, N to kb', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'test.md'), 'hello');
    writeConfig({ mindRoot });

    // Y proceed, Y remove config, N remove kb
    const { stdout } = run(['uninstall'], { input: 'y\ny\nn\n' });
    expect(fs.existsSync(path.join(tempHome, '.mindos'))).toBe(false);
    expect(fs.existsSync(mindRoot)).toBe(true);
  });
});

describe('mindos uninstall — knowledge base triple protection', () => {
  it('keeps knowledge base when user types wrong confirmation (not YES)', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    writeConfig({ mindRoot });

    // Y proceed, N config, Y kb, type "yes" (wrong — must be uppercase YES)
    const { stdout } = run(['uninstall'], { input: 'y\nn\ny\nyes\n' });
    expect(stdout).toContain('Knowledge base kept');
    expect(fs.existsSync(mindRoot)).toBe(true);
  });

  it('keeps knowledge base when password is wrong', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    writeConfig({ mindRoot, webPassword: 'secret123' });

    // Y proceed, N config, Y kb, YES confirm, wrong password
    const { stdout } = run(['uninstall'], { input: 'y\nn\ny\nYES\nwrongpw\n' });
    expect(stdout).toContain('Wrong password');
    expect(fs.existsSync(mindRoot)).toBe(true);
  });

  it('deletes knowledge base when all protections pass (no password)', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'data');
    writeConfig({ mindRoot });

    // Y proceed, N config, Y kb, YES confirm
    const { stdout } = run(['uninstall'], { input: 'y\nn\ny\nYES\n' });
    expect(stdout).toContain('Removed');
    expect(fs.existsSync(mindRoot)).toBe(false);
  });

  it('deletes knowledge base when all protections pass (correct password)', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    writeConfig({ mindRoot, webPassword: 'mypass' });

    // Y proceed, N config, Y kb, YES confirm, correct password
    const { stdout } = run(['uninstall'], { input: 'y\nn\ny\nYES\nmypass\n' });
    expect(fs.existsSync(mindRoot)).toBe(false);
  });
});

describe('mindos uninstall — config read ordering (regression)', () => {
  /**
   * Regression: config must be read BEFORE ~/.mindos/ is deleted.
   * Otherwise mindRoot and webPassword are lost, and the knowledge base
   * question is silently skipped.
   *
   * Test: user says Y to proceed, Y to delete config, then expects the
   * knowledge base question to still appear (config was read beforehand).
   */
  it('still asks about knowledge base even after deleting ~/.mindos/', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'data');
    writeConfig({ mindRoot });

    // Y proceed, Y remove config (deletes ~/.mindos/), Y remove kb, YES confirm
    const { stdout } = run(['uninstall'], { input: 'y\ny\ny\nYES\n' });
    // Config dir should be gone
    expect(fs.existsSync(path.join(tempHome, '.mindos'))).toBe(false);
    // Knowledge base should also be gone — proves config was read before deletion
    expect(fs.existsSync(mindRoot)).toBe(false);
  });

  it('password check works even after config dir is deleted', () => {
    const mindRoot = path.join(tempHome, 'MindOS');
    fs.mkdirSync(mindRoot, { recursive: true });
    writeConfig({ mindRoot, webPassword: 'pw123' });

    // Y proceed, Y remove config, Y remove kb, YES, wrong password
    const { stdout } = run(['uninstall'], { input: 'y\ny\ny\nYES\nwrong\n' });
    expect(fs.existsSync(path.join(tempHome, '.mindos'))).toBe(false);
    expect(stdout).toContain('Wrong password');
    // Knowledge base must survive — password was read from config before deletion
    expect(fs.existsSync(mindRoot)).toBe(true);
  });
});

describe('mindos uninstall — tilde expansion in mindRoot', () => {
  it('normalizes only absolute or home-relative knowledge base paths', async () => {
    const { normalizeUninstallMindRoot } = await import('../../packages/mindos/bin/commands/uninstall.js');

    expect(normalizeUninstallMindRoot('~/MyNotes', tempHome)).toBe(path.join(tempHome, 'MyNotes'));
    expect(normalizeUninstallMindRoot('.', tempHome)).toBeNull();
    expect(normalizeUninstallMindRoot('relative/notes', tempHome)).toBeNull();
    expect(normalizeUninstallMindRoot('~other/notes', tempHome)).toBeNull();
  });

  it('expands ~ in mindRoot to HOME', () => {
    const mindRoot = path.join(tempHome, 'MyNotes');
    fs.mkdirSync(mindRoot, { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'test.md'), 'data');
    // Store with ~ prefix — the code should expand it
    writeConfig({ mindRoot: '~/MyNotes' });

    // Y proceed, N config, Y kb, YES
    const { stdout } = run(['uninstall'], { input: 'y\nn\ny\nYES\n' });
    expect(fs.existsSync(mindRoot)).toBe(false);
  });
});
