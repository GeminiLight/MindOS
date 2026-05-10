import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('desktop main subprocess cleanup contract', () => {
  it('uses argv-safe subprocess calls for launchd and systemd cleanup', () => {
    const source = readFileSync(path.join(__dirname, 'main.ts'), 'utf-8');

    expect(source).not.toContain("require('child_process')");
    expect(source).not.toContain('execAsync(');
    expect(source).not.toContain('gui/$(id -u)');
    expect(source).not.toContain('2>/dev/null || true');
    expect(source).not.toContain('pkill -f "');
    expect(source).toContain("execFileAsync('launchctl', ['bootout', `gui/${uid}/com.mindos.app`]");
    expect(source).toContain("execFileAsync('pkill', ['-f', 'node_modules/@geminilight/mindos/bin/cli.js start']");
    expect(source).toContain("execFileAsync('systemctl', ['--user', 'is-active', service]");
  });
});
