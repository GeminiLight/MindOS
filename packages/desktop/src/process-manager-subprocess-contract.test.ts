import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { isMindosOwnedCommandLine } from './process-manager';

describe('process-manager subprocess cleanup contract', () => {
  it('uses argv-safe subprocess calls for port and process probes', () => {
    const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

    expect(source).not.toContain("require('child_process')");
    expect(source).not.toContain('execAsync(');
    expect(source).not.toContain('lsof -ti:${port}');
    expect(source).not.toContain('ss -tlnp sport = :${port}');
    expect(source).not.toContain('fuser ${port}/tcp 2>&1');
    expect(source).not.toContain('wmic process where ProcessId=${pid}');
    expect(source).not.toContain('ps -p ${pid} -o comm=');
    expect(source).toContain("execFileAsync('lsof', [`-ti:${port}`]");
    expect(source).toContain("execFileAsync('ss', ['-tlnp', 'sport', '=', `:${port}`]");
    expect(source).toContain("execFileAsync('fuser', [`${port}/tcp`]");
    expect(source).toContain("execFileAsync('wmic', ['process', 'where', `ProcessId=${pid}`");
    expect(source).toContain("execFileAsync('ps', ['-p', String(pid), '-o', 'args=']");
  });

  it('only treats MindOS-owned command lines as safe cleanup targets', () => {
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /Users/me/app/server.js')).toBe(false);
    expect(isMindosOwnedCommandLine('/usr/local/bin/next start -p 3000')).toBe(false);
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /Users/me/.mindos/runtime/packages/web/.next/standalone/server.js')).toBe(true);
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /Applications/MindOS.app/Contents/Resources/mindos-runtime/dist/protocols/mcp-server/index.cjs')).toBe(true);
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /usr/local/lib/node_modules/@geminilight/mindos/bin/cli.js start')).toBe(true);
  });
});
