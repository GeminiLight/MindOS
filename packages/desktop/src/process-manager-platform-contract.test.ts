import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
// The process layer is three files since the split; these rules cover all of it.

const source = ['process-manager.ts', 'process-kill.ts', 'process-cleanup.ts'].map((f) => readFileSync(path.join(__dirname, f), 'utf-8')).join('\n');

function fnBody(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `marker not found: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('process-manager cross-platform contract', () => {
  it('kills the Windows process tree up front, not only in the force-kill timer', () => {
    // proc.kill() on Windows terminates only the direct child; its exit clears
    // the timer, so a timer-only taskkill never fires and grandchildren keep the port.
    const body = fnBody('function terminateChildProcess', 'function isPidAlive');
    const taskkill = body.indexOf("execFile('taskkill.exe'");
    const sigterm = body.indexOf("proc.kill('SIGTERM')");
    expect(taskkill).toBeGreaterThan(-1);
    expect(sigterm).toBeGreaterThan(-1);
    expect(taskkill).toBeLessThan(sigterm);
    expect(body).toContain('/T');
  });

  it('terminatePid tree-kills first on Windows instead of after the alive-poll', () => {
    const body = fnBody('async function terminatePid', 'export const _terminateChildProcess_forTest');
    const taskkill = body.indexOf("execFile('taskkill.exe'");
    const deadline = body.indexOf('const deadline');
    expect(taskkill).toBeGreaterThan(-1);
    expect(taskkill).toBeLessThan(deadline);
  });

  it('never spawns through an unquoted shell (paths with spaces would split)', () => {
    expect(source).not.toContain('shell: IS_WIN');
    expect(source).not.toContain('shell: true');
    expect(source).toContain('resolveExecTarget(localNext');
    expect(source).toContain('resolveExecTarget(this.opts.npxPath');
  });

  it('binds MCP to loopback by default with MINDOS_MCP_HOST as the explicit opt-in', () => {
    expect(source).not.toContain("MCP_HOST: '0.0.0.0'");
    expect(source).toContain(".MINDOS_MCP_HOST || '127.0.0.1'");
  });

  it('passes windowsHide to every child-process call site (no console window flashes)', () => {
    for (const token of ['spawn(', "execFile('", 'execFileAsync(']) {
      let idx = source.indexOf(token);
      while (idx !== -1) {
        const window = source.slice(idx, idx + 800);
        expect(window, `call site at index ${idx} (${token}) missing windowsHide`).toContain('windowsHide');
        idx = source.indexOf(token, idx + 1);
      }
    }
  });

  it('bails out of the startup health poll when spawn itself failed (no exit event)', () => {
    expect(source).toContain('this.webSpawnFailed = true;');
    const waitBody = fnBody('private async waitForReady', 'private guardSpawnError');
    expect(waitBody).toContain('this.webSpawnFailed');
  });

  it('surfaces an error instead of returning the occupied port from the fallback path', () => {
    const body = fnBody('private async waitForPortOrFallback', 'private logCrash');
    expect(body).not.toContain('.catch(() => port)');
    expect(body).toContain('throw new Error');
  });
});
