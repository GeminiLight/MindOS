import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
describe('Desktop installation data ownership', () => {
  it('does not stop services when the installer opens', () => {
    const nsis = read('packages/desktop/build/installer.nsh');
    expect(nsis.match(/!macro customInit[\s\S]*?!macroend/)?.[0] ?? '').not.toContain('mindosStopRuntimeChildren');
  });
  it('protects the legacy uninstaller before replacing an existing application', () => {
    const nsis = read('packages/desktop/build/installer.nsh');
    expect(nsis).toContain('-Action Protect');
    const cleanup = nsis.slice(nsis.indexOf('!macro customUnInstall'));
    expect(cleanup).toContain('${ifNot} ${isUpdated}');
    expect(cleanup).toContain('--purge');
  });
  it('requires a successful native launch for both Windows architectures', () => {
    const workflow = read('.github/workflows/build-desktop.yml');
    expect(workflow).toContain('os: windows-11-arm');
    expect(workflow).not.toContain('--windows-runtime-fallback');
    expect(workflow).not.toContain('--windows-runtime-only');
    expect(workflow).not.toContain('--skip-if-arch-mismatch');
  });
});
