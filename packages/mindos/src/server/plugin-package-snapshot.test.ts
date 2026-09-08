import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPluginPackageSnapshot } from './plugin-package-snapshot.js';
import { handleFileGet } from './handlers/file.js';

let root: string;
const location = '.mindos/plugins/example';
function put(file: string, content: string | Buffer) {
  const target = join(root, location, file);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mindos-package-snapshot-'));
  put('manifest.json', '{"id":"example","name":"Example","version":"1.0.0"}');
  put('main.js', 'throw new Error("must never execute while inspecting");');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('immutable plugin package snapshot', () => {
  it('captures exact source and binary assets without executing code', () => {
    put('images/图标.png', Buffer.from([0, 255, 128]));
    const result = readPluginPackageSnapshot(root, location);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.files.find(file => file.path === 'main.js')?.base64).toBe(Buffer.from('throw new Error("must never execute while inspecting");').toString('base64'));
    expect(result.files.find(file => file.path === 'images/图标.png')?.base64).toBe('AP+A');
    expect(readPluginPackageSnapshot(root, location).fingerprint).toBe(result.fingerprint);
  });

  it.each(['main.js', 'styles.css', 'images/new.svg', 'manifest.json'])('changes the fingerprint when %s changes', file => {
    const before = readPluginPackageSnapshot(root, location);
    put(file, 'changed');
    expect(readPluginPackageSnapshot(root, location).fingerprint).not.toBe(before.fingerprint);
  });

  it('does not put mutable plugin settings into the executable package or approval fingerprint', () => {
    const before = readPluginPackageSnapshot(root, location);
    put('data.json', '{"userSecret":"not-a-code-asset"}');
    const after = readPluginPackageSnapshot(root, location);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.files.some(file => file.path === 'data.json')).toBe(false);
  });

  it('uses the same knowledge root identity as the document save protocol', () => {
    const snapshot = readPluginPackageSnapshot(root, location);
    const document = handleFileGet(new URLSearchParams({ path: `${location}/main.js` }), {
      mindRoot: root, readTextFile: () => 'source', readLines: () => [], listDirectories: () => [], listSpaces: () => [],
    }).body as { vaultId: string };
    expect(snapshot.vaultId).toBe(document.vaultId);
  });

  it('rejects a symlink asset even when it points inside the knowledge root', () => {
    writeFileSync(join(root, 'private.md'), 'private');
    symlinkSync(join(root, 'private.md'), join(root, location, 'asset.md'));
    expect(() => readPluginPackageSnapshot(root, location)).toThrow(/symlink/i);
  });

  it('rejects a symlink package directory', () => {
    symlinkSync(join(root, location), join(root, '.mindos/plugins/alias'));
    expect(() => readPluginPackageSnapshot(root, '.mindos/plugins/alias')).toThrow(/symlink/i);
  });

  it('rejects hard links that could expose a file outside the package', () => {
    writeFileSync(join(root, 'private.md'), 'private');
    linkSync(join(root, 'private.md'), join(root, location, 'resource.md'));
    expect(() => readPluginPackageSnapshot(root, location)).toThrow(/hard link/i);
  });

  it.each(['../outside', '/tmp', 'C:/outside', '.mindos/plugins/example/../other'])('rejects non-canonical package locations: %s', path => {
    expect(() => readPluginPackageSnapshot(root, path)).toThrow();
  });

  it('enforces file, total-byte, and count limits before returning a partial snapshot', () => {
    expect(() => readPluginPackageSnapshot(root, location, { maxFileBytes: 5 })).toThrow(/limit/i);
    expect(() => readPluginPackageSnapshot(root, location, { maxTotalBytes: 5 })).toThrow(/limit/i);
    expect(() => readPluginPackageSnapshot(root, location, { maxFiles: 1 })).toThrow(/limit/i);
  });

  it('fails rather than returning an empty package when the directory is missing', () => {
    expect(() => readPluginPackageSnapshot(root, '.mindos/plugins/missing')).toThrow();
  });
});
