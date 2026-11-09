import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('desktop main subprocess cleanup contract', () => {
  it('uses argv-safe subprocess calls for launchd and systemd cleanup', () => {
    // Boot healing moved out of main.ts into boot-heal.ts; the argv-safety
    // contract follows the code.
    const source = readFileSync(path.join(__dirname, 'boot-heal.ts'), 'utf-8');

    expect(source).not.toContain("require('child_process')");
    expect(source).not.toContain('execAsync(');
    expect(source).not.toContain('gui/$(id -u)');
    expect(source).not.toContain('2>/dev/null || true');
    expect(source).not.toContain('pkill -f "');
    expect(source).not.toContain('| xargs kill');
    expect(source).toContain("execFileAsync('launchctl', ['bootout', `gui/${uid}/com.mindos.app`]");
    expect(source).toContain("'node_modules/@geminilight/mindos/bin/cli.js start'");
    expect(source).toContain("execFileAsync('pkill', ['-f', pattern]");
    expect(source).toContain("execFileAsync('systemctl', ['--user', 'is-active', service]");
  });

  it('keeps main.ts free of shell-string subprocess calls', () => {
    const source = readFileSync(path.join(__dirname, 'main.ts'), 'utf-8');

    expect(source).not.toContain("require('child_process')");
    expect(source).not.toContain('execAsync(');
    expect(source).not.toContain('| xargs kill');
  });

  it('waits for orphan cleanup before retrying exhausted port discovery', () => {
    // Local-mode boot moved to local-mode.ts.
    const source = readFileSync(path.join(__dirname, 'local-mode.ts'), 'utf-8');

    expect(source).toContain('await ProcessManager.cleanupOrphanedChildren();');
    expect(source).not.toContain('\n    ProcessManager.cleanupOrphanedChildren();');
  });

  it('uses MindOS health payload checks before recovery reloads the Web UI', () => {
    const source = readFileSync(path.join(__dirname, 'local-mode.ts'), 'utf-8');

    expect(source).toContain('verifyMindOsWebHealth(effectiveWebPort, 3000)');
    expect(source).not.toContain("fetch(`http://127.0.0.1:${effectiveWebPort}/api/health`");
  });
});
