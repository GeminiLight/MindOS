import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import { copyAppForBundledRuntime, materializeStandaloneAssets } from '../scripts/prepare-mindos-bundle.mjs';
import { getStandaloneAppRequiredEntries } from '../scripts/runtime-health-contract.mjs';

function writeStandaloneApp(appDir: string, omit: string[] = []) {
  for (const entry of getStandaloneAppRequiredEntries()) {
    if (omit.includes(entry.path)) continue;
    const target = path.join(appDir, entry.path);
    if (entry.type === 'directory') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `// ${entry.path}`);
    }
  }
}

const created: string[] = [];

function makeTemp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('materializeStandaloneAssets', () => {
  it('throws when standalone server.js is missing', () => {
    const appDir = makeTemp('mindos-app-');
    mkdirSync(path.join(appDir, '.next', 'standalone'), { recursive: true });
    expect(() => materializeStandaloneAssets(appDir)).toThrow(/Missing .*server\.js/);
  });

  it('copies .next/static and public into standalone', () => {
    const appDir = makeTemp('mindos-app-');
    const standalone = path.join(appDir, '.next', 'standalone');
    writeStandaloneApp(appDir);

    mkdirSync(path.join(appDir, '.next', 'static', 'chunks'), { recursive: true });
    writeFileSync(path.join(appDir, '.next', 'static', 'chunks', 'a.js'), 'a');

    mkdirSync(path.join(appDir, 'public'), { recursive: true });
    writeFileSync(path.join(appDir, 'public', 'favicon.ico'), 'ico');

    materializeStandaloneAssets(appDir);

    const staticFile = path.join(standalone, '.next', 'static', 'chunks', 'a.js');
    expect(existsSync(staticFile)).toBe(true);
    expect(readFileSync(staticFile, 'utf-8')).toBe('a');

    const pub = path.join(standalone, 'public', 'favicon.ico');
    expect(existsSync(pub)).toBe(true);
    expect(readFileSync(pub, 'utf-8')).toBe('ico');
  });

  it('throws when required pdf runtime files are missing', () => {
    const appDir = makeTemp('mindos-app-missing-pdf-');
    writeStandaloneApp(appDir, [
      '.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      '.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ]);
    expect(() => materializeStandaloneAssets(appDir)).toThrow(/Incomplete standalone runtime/);
  });
});

describe('copyAppForBundledRuntime', () => {
  it('throws when source app directory is missing', () => {
    const dest = makeTemp('mindos-dest-');
    expect(() => copyAppForBundledRuntime(path.join(dest, 'nope'), path.join(dest, 'out'))).toThrow(
      /Missing app directory/
    );
  });

  it('omits node_modules and .next/cache', () => {
    const src = makeTemp('mindos-src-');
    const dest = path.join(makeTemp('mindos-dest-'), 'app');

    writeFileSync(path.join(src, 'package.json'), '{}');
    mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(src, 'node_modules', 'x', 'bad.js'), 'bad');

    mkdirSync(path.join(src, '.next', 'cache', 'foo'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'cache', 'foo', 'c.bin'), 'cache');

    mkdirSync(path.join(src, '.next', 'dev', 'junk'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'dev', 'junk', 'big.bin'), 'devcache');

    mkdirSync(path.join(src, '.next', 'standalone'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'standalone', 'server.js'), 'ok');

    copyAppForBundledRuntime(src, dest);

    expect(existsSync(path.join(dest, 'package.json'))).toBe(true);
    expect(existsSync(path.join(dest, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'cache'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'dev'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'standalone', 'server.js'))).toBe(true);
  });

  it('replaces destination on each run', () => {
    const src = makeTemp('mindos-src2-');
    const destRoot = makeTemp('mindos-dest2-');
    const dest = path.join(destRoot, 'app');
    writeFileSync(path.join(src, 'a.txt'), 'v1');

    copyAppForBundledRuntime(src, dest);
    expect(readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('v1');

    writeFileSync(path.join(src, 'a.txt'), 'v2');
    copyAppForBundledRuntime(src, dest);
    expect(readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('v2');
  });
});
