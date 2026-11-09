import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Each case spawns a real shell that scans `ps` once per recorded pid, so a
 * case costs ~1s even when idle. The default 5s budget passed only on an
 * unloaded machine; under parallel builds (or on CI) it times out and looks
 * like a product failure. Budget for a busy machine instead.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/tmp/app', getLocale: () => 'en-US' },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: {},
  Notification: class { static isSupported() { return false; } show() {} },
}));

/**
 * Executes ~/.mindos/uninstall.sh for real against a throwaway HOME.
 *
 * Until now this script was only checked with `sh -n` and string assertions,
 * and on macOS/Linux it was never invoked at all — `uninstall-app` only moved
 * the bundle to the Trash. It is now run on every uninstall, so it deletes
 * directories and rewrites the user's shell startup files for real. These
 * tests exercise the actual behaviour, including what it must NOT touch.
 */

const MARKER = '# MindOS Desktop — CLI (mindos)';
const PATH_LINE = 'export PATH="$HOME/.mindos/bin:$PATH"';
/** No such process: `ps -p` prints nothing, so no terminate_pid branch can fire. */
const DEAD_PID = '999999';

let home: string;

function w(rel: string, content: string): string {
  const abs = path.join(home, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  return abs;
}

function read(rel: string): string {
  return readFileSync(path.join(home, rel), 'utf-8');
}

function has(rel: string): boolean {
  return existsSync(path.join(home, rel));
}

async function runUninstall(): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const { buildUnixUninstallScript } = await import('./install-cli-shim');
  const script = path.join(home, '.mindos', 'uninstall.sh');
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, buildUnixUninstallScript(), { mode: 0o755 });
  const res = spawnSync('sh', [script], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home },
    timeout: 30_000,
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'mindos-uninstall-'));

  // ── shell startup files ──
  w('.zshrc', [
    '# my own setup',
    'export EDITOR=nvim',
    'alias gs="git status"',
    '',
    MARKER,
    PATH_LINE,
    '',
    'eval "$(starship init zsh)"',
  ].join('\n') + '\n');

  // Legacy marker from the old CLI installer.
  w('.bashrc', ['export FOO=1', '# MindOS CLI', PATH_LINE, 'export BAR=2'].join('\n') + '\n');

  // Created by the Desktop installer.
  w('.zshenv', [MARKER, PATH_LINE].join('\n') + '\n');

  // Never touched by MindOS — must come out byte-identical.
  w('.profile', ['# unrelated profile', 'export PATH="$HOME/bin:$PATH"', 'umask 022'].join('\n') + '\n');

  w('.config/fish/conf.d/mindos.fish', 'fish_add_path $HOME/.mindos/bin\n');

  // ── MindOS-managed state ──
  w('.mindos/bin/mindos', '#!/bin/sh\nexec node cli.js "$@"\n');
  w('.mindos/node/bin/node', 'binary');
  w('.mindos/runtime/package.json', '{"version":"1.0.0"}');
  w('.mindos/runtime-old/package.json', '{}');
  w('.mindos/runtime-downloading/partial', 'x');
  w('.mindos/runtime-download.tar.gz', 'x');
  w('.mindos/config.json', '{"mindRoot":"~/MindOS/mind"}');
  w('.mindos/stdin-watchdog.cjs', '//');
  w('.mindos/cli-shim-stamp.json', '{}');
  w('.mindos/update-status.json', '{}');
  w('.mindos/desktop-cli-path-notify-v1', 'x');
  w('.mindos/mindos.pid', `${DEAD_PID}\n`);
  w('.mindos/desktop-children.pid', `${DEAD_PID}\n`);
  w('.mindos/ssh-tunnel.pid', `${DEAD_PID}\n`);
  w('.mindos/tmp/scratch', 'x');
  w('.mindos/sessions/a.json', '{}');

  // User data that MUST survive.
  w('MindOS/mind/note.md', '# my note\n');
  w('MindOS/mind/.obsidian/app.json', '{}');
  w('.mindos/private-learning/keep.md', 'private');

  // A third-party config the script may only *mention*, never edit.
  w('.claude.json', '{"mcpServers":{"mindos":{"url":"http://127.0.0.1:8781/mcp"}}}');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.resetModules();
});

describe('uninstall.sh — real execution', () => {
  it('exits cleanly', async () => {
    const res = await runUninstall();
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('never deletes the knowledge base', async () => {
    await runUninstall();
    expect(has('MindOS/mind/note.md')).toBe(true);
    expect(read('MindOS/mind/note.md')).toBe('# my note\n');
    expect(has('MindOS/mind/.obsidian/app.json')).toBe(true);
  });

  it('removes Desktop-managed runtimes and the CLI shim', async () => {
    await runUninstall();
    expect(has('.mindos/node')).toBe(false);
    expect(has('.mindos/runtime')).toBe(false);
    expect(has('.mindos/runtime-old')).toBe(false);
    expect(has('.mindos/runtime-downloading')).toBe(false);
    expect(has('.mindos/runtime-download.tar.gz')).toBe(false);
    expect(has('.mindos/bin/mindos')).toBe(false);
  });

  it('removes config and state files', async () => {
    await runUninstall();
    for (const f of [
      '.mindos/config.json', '.mindos/stdin-watchdog.cjs', '.mindos/cli-shim-stamp.json',
      '.mindos/update-status.json', '.mindos/desktop-cli-path-notify-v1',
      '.mindos/tmp', '.mindos/sessions',
      '.mindos/mindos.pid', '.mindos/desktop-children.pid', '.mindos/ssh-tunnel.pid',
    ]) {
      expect(has(f), `${f} should be gone`).toBe(false);
    }
  });

  it('strips its own PATH block from shell files without touching user lines', async () => {
    await runUninstall();

    const zshrc = read('.zshrc');
    expect(zshrc).not.toContain('.mindos/bin');
    expect(zshrc).not.toContain('MindOS');
    // Everything the user wrote survives, in order.
    expect(zshrc).toContain('# my own setup');
    expect(zshrc).toContain('export EDITOR=nvim');
    expect(zshrc).toContain('alias gs="git status"');
    expect(zshrc).toContain('eval "$(starship init zsh)"');

    const bashrc = read('.bashrc');
    expect(bashrc).not.toContain('.mindos/bin');
    expect(bashrc).toContain('export FOO=1');
    expect(bashrc).toContain('export BAR=2');

    expect(read('.zshenv').trim()).toBe('');
  });

  it('leaves an unrelated startup file byte-identical', async () => {
    const before = read('.profile');
    await runUninstall();
    expect(read('.profile')).toBe(before);
  });

  // Regression: the detection grep was written in a JS template literal, which
  // swallowed its backslashes. The script ended up grepping for
  // `$HOME/.mindos/bin:$PATH`, where a mid-pattern `$` is an anchor — so a file
  // holding only the raw PATH line (no MindOS comment marker) was skipped and
  // the line outlived the uninstall. Every other fixture here has a marker,
  // which is why this branch had never run.
  it('also strips a raw PATH line that has no MindOS marker above it', async () => {
    w('.bash_profile', ['export LANG=en_US.UTF-8', PATH_LINE, 'export BAZ=3'].join('\n') + '\n');
    await runUninstall();

    const profile = read('.bash_profile');
    expect(profile).not.toContain('.mindos/bin');
    expect(profile).toContain('export LANG=en_US.UTF-8');
    expect(profile).toContain('export BAZ=3');
  });

  it('does not strip a PATH line that only resembles its own', async () => {
    // The fixed pattern escapes `.` and `$`, so this lookalike must survive.
    const lookalike = 'export PATH="$HOME/xmindos/bin:$PATH"';
    w('.bash_profile', [lookalike].join('\n') + '\n');
    await runUninstall();
    expect(read('.bash_profile')).toContain(lookalike);
  });

  it('keeps a lookalike line even in a file it does clean', async () => {
    // Once the grep gate lets a file through, sed decides line by line; an
    // unescaped `.` there matched any character.
    const lookalike = 'export PATH="$HOME/xmindos/bin:$PATH"';
    w('.bash_profile', [MARKER, PATH_LINE, lookalike].join('\n') + '\n');
    await runUninstall();
    const profile = read('.bash_profile');
    expect(profile).toContain(lookalike);
    expect(profile).not.toContain('$HOME/.mindos/bin');
  });

  it('emits the regex escapes into the script, not just into the TypeScript source', async () => {
    const { buildUnixUninstallScript } = await import('./install-cli-shim');
    const line = buildUnixUninstallScript().split('\n').find((l) => l.includes('grep -Eq'));
    expect(line).toContain('export PATH="\\$HOME/\\.mindos/bin:\\$PATH"');
  });

  it('removes the fish config it created', async () => {
    await runUninstall();
    expect(has('.config/fish/conf.d/mindos.fish')).toBe(false);
  });

  it('only reports third-party MCP configs, never edits them', async () => {
    const before = read('.claude.json');
    const res = await runUninstall();
    expect(read('.claude.json')).toBe(before);
    expect(res.stdout).toContain('.claude.json');
    expect(res.stdout.toLowerCase()).toContain('manually');
  });

  it('keeps data it does not own and therefore leaves ~/.mindos in place', async () => {
    await runUninstall();
    // private-learning is not in the removal list, so the final rmdir is a no-op.
    expect(has('.mindos/private-learning/keep.md')).toBe(true);
    expect(has('.mindos')).toBe(true);
  });

  it('removes itself', async () => {
    await runUninstall();
    expect(has('.mindos/uninstall.sh')).toBe(false);
  });

  it('is idempotent — a second run on a clean home still exits 0', async () => {
    await runUninstall();
    const second = await runUninstall();
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
    expect(has('MindOS/mind/note.md')).toBe(true);
  });

  it('survives a home with none of the files it expects', async () => {
    rmSync(path.join(home, '.mindos'), { recursive: true, force: true });
    rmSync(path.join(home, '.zshrc'), { force: true });
    rmSync(path.join(home, '.bashrc'), { force: true });
    rmSync(path.join(home, '.zshenv'), { force: true });
    rmSync(path.join(home, '.config'), { recursive: true, force: true });
    const res = await runUninstall();
    expect(res.status).toBe(0);
    expect(has('MindOS/mind/note.md')).toBe(true);
  });

  it('does not kill processes that are not MindOS', async () => {
    // A live PID that is plainly not MindOS: the test runner itself.
    w('.mindos/mindos.pid', `${process.pid}\n`);
    const res = await runUninstall();
    expect(res.status).toBe(0);
    // Still alive — process.kill(pid, 0) throws only if it is gone.
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });
});
