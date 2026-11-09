import { describe, expect, it } from 'vitest';
import { TailBuffer, describeFailure, runCommand, runCommandSequence } from './run-command';

const NODE = process.execPath;

describe('TailBuffer', () => {
  it('keeps only the last N lines', () => {
    const buf = new TailBuffer(3);
    for (let i = 1; i <= 10; i++) buf.push(`line ${i}\n`);
    expect(buf.toString()).toBe('line 8\nline 9\nline 10');
  });

  it('joins chunks that split mid-line', () => {
    const buf = new TailBuffer(5);
    buf.push('hel');
    buf.push('lo\nwor');
    buf.push('ld\n');
    expect(buf.toString()).toBe('hello\nworld');
  });

  it('retains a trailing line that never got a newline', () => {
    const buf = new TailBuffer(5);
    buf.push('no newline at eof');
    expect(buf.toString()).toBe('no newline at eof');
  });

  it('stays bounded for a very large stream', () => {
    const buf = new TailBuffer(2);
    for (let i = 0; i < 50_000; i++) buf.push(`${i}\n`);
    expect(buf.toString().split('\n')).toHaveLength(2);
  });
});

describe('runCommand', () => {
  it('reports success and captures stdout', async () => {
    const result = await runCommand(NODE, ['-e', 'process.stdout.write("hello")']);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('reports a non-zero exit with the stderr tail instead of throwing', async () => {
    const result = await runCommand(NODE, ['-e', 'process.stderr.write("boom"); process.exit(3)']);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toBe('boom');
  });

  it('survives output far larger than the old 1 MB exec maxBuffer', async () => {
    // 4 MB of stdout — promisify(exec) would kill the child with ENOBUFS here.
    const result = await runCommand(NODE, [
      '-e',
      'for (let i = 0; i < 40000; i++) process.stdout.write("x".repeat(100) + "\\n"); process.exit(0)',
    ]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n').length).toBeLessThanOrEqual(40);
  });

  it('times out and kills a hanging command', async () => {
    const result = await runCommand(NODE, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('aborts when the caller cancels', async () => {
    const controller = new AbortController();
    const pending = runCommand(NODE, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('returns a spawn error instead of throwing when the binary is missing', async () => {
    const result = await runCommand('definitely-not-a-real-binary-xyz', []);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('runCommandSequence', () => {
  it('stops at the first failing step', async () => {
    const result = await runCommandSequence([
      { command: NODE, args: ['-e', 'process.exit(0)'] },
      { command: NODE, args: ['-e', 'process.stderr.write("step2 failed"); process.exit(1)'] },
      { command: NODE, args: ['-e', 'process.stdout.write("never runs"); process.exit(0)'] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('step2 failed');
    expect(result.stdout).not.toContain('never runs');
  });

  it('reports success when every step passes', async () => {
    const result = await runCommandSequence([
      { command: NODE, args: ['-e', 'process.exit(0)'] },
      { command: NODE, args: ['-e', 'process.stdout.write("done")'] },
    ]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('done');
  });

  it('treats an empty step list as success', async () => {
    await expect(runCommandSequence([])).resolves.toMatchObject({ ok: true });
  });
});

describe('describeFailure', () => {
  it('distinguishes cancel, timeout, spawn error and exit code', () => {
    expect(describeFailure({ ok: false, code: null, stdout: '', stderr: '', aborted: true })).toBe('cancelled');
    expect(describeFailure({ ok: false, code: null, stdout: '', stderr: '', timedOut: true })).toBe('timed out');
    expect(describeFailure({ ok: false, code: null, stdout: '', stderr: '', error: 'ENOENT' })).toBe('ENOENT');
    expect(describeFailure({ ok: false, code: 7, stdout: '', stderr: '' })).toBe('exit code 7');
  });

  it('prefers the stderr tail when there is output', () => {
    expect(describeFailure({ ok: false, code: 1, stdout: 'out', stderr: 'a\nb\nc\nd' })).toBe('b\nc\nd');
  });
});
