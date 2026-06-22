import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

describe('setup.js subprocess contract', () => {
  it('uses argv-safe subprocess calls for setup helpers', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).not.toContain('exec(`node');
    expect(source).not.toContain("execFileSync('tar', ['-xzf', tarPath, '-C', extractDir]");
    expect(source).toContain('extractTarGzSafe(tarPath, extractDir)');
    expect(source).toContain('function resolveTarEntryPath(destDir, entryName)');
    expect(source).toContain('Template tar entry outside extraction directory');
    expect(source).toContain("execFileSync('open', [url]");
    expect(source).toContain("execFileSync('cmd.exe', ['/c', 'start', '', url]");
    expect(source).toContain("execFileSync(process.execPath, [cliPath, 'restart']");
    expect(source).toContain("resolveNpxInvocation(args)");
    expect(source).toContain("function supportsDaemonService(platform = process.platform)");
    expect(source).toContain("resolveNpmInvocation(['link', '--global'])");
    expect(source).toContain("cwd: resolve(ROOT, 'packages', 'mindos')");
    expect(source).toContain("--install-daemon is only supported on macOS/Linux");
  });
});
