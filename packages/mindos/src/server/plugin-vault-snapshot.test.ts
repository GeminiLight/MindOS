import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as server from './index.js';
import { readPluginPackageSnapshot } from './plugin-package-snapshot.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mindos-vault-snapshot-'));
  mkdirSync(join(root, '.mindos/plugins/reader'), { recursive: true });
  writeFileSync(join(root, '.mindos/plugins/reader/manifest.json'), JSON.stringify({ id: 'reader', name: 'Reader', version: '1.0.0' }));
  writeFileSync(join(root, '.mindos/plugins/reader/main.js'), 'module.exports = class Reader {};');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const binding = () => {
  const code = readPluginPackageSnapshot(root, '.mindos/plugins/reader');
  return { pluginId: 'reader', vaultId: code.vaultId, fingerprint: code.fingerprint };
};
function capture(subject = binding(), limits?: unknown) {
  expect((server as any).readPluginVaultSnapshot).toBeTypeOf('function');
  return (server as any).readPluginVaultSnapshot(root, subject, limits);
}

it('captures actual visible files and empty directories without private plugin/configuration data', () => {
  mkdirSync(join(root, 'Notes')); mkdirSync(join(root, 'Empty'));
  writeFileSync(join(root, 'Notes/中文.md'), '# 中文\n#tag');
  writeFileSync(join(root, 'asset.bin'), Buffer.from([0, 255, 128]));
  writeFileSync(join(root, '.env'), 'private-secret');
  const subject = binding(); const result = capture(subject);
  expect(result.vaultId).toBe(subject.vaultId); expect(result.pluginFingerprint).toBe(subject.fingerprint);
  expect(result.files.map((f: any) => f.path)).toEqual(['Notes/中文.md', 'asset.bin']);
  expect(result.folders).toEqual(['Empty', 'Notes']);
  expect(Buffer.from(result.files[0].base64, 'base64').toString('utf8')).toBe('# 中文\n#tag');
  expect(Buffer.from(result.files[1].base64, 'base64')).toEqual(Buffer.from([0, 255, 128]));
  expect(result.files[0].stat.mtime).toBeGreaterThan(0); expect(result.files[0].stat.ctime).toBeGreaterThan(0);
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/); expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain('private-secret'); expect(JSON.stringify(result)).not.toContain(root);
  expect(Object.isFrozen(result.files[0].stat)).toBe(true);
});

it('refuses changed code or knowledge-root identity before reading the vault', () => {
  const subject = binding();
  expect(() => capture({ ...subject, vaultId: '0'.repeat(64) })).toThrow(/changed/i);
  expect(() => capture({ ...subject, fingerprint: '0'.repeat(64) })).toThrow(/changed/i);
  writeFileSync(join(root, '.mindos/plugins/reader/main.js'), 'changed');
  expect(() => capture(subject)).toThrow(/changed/i);
});

it('rejects symbolic links and hard links instead of exposing a different filesystem scope', () => {
  writeFileSync(join(root, 'note.md'), 'content'); symlinkSync('note.md', join(root, 'linked.md'));
  expect(() => capture()).toThrow(/link/i);
  rmSync(join(root, 'linked.md')); linkSync(join(root, 'note.md'), join(root, 'hard.md'));
  expect(() => capture()).toThrow(/link/i);
});

it('fails the whole snapshot on size/count limits and changes its revision when content changes', () => {
  writeFileSync(join(root, 'a.md'), 'one'); const first = capture();
  expect(() => capture(binding(), { maxFileBytes: 2 })).toThrow(/limit/i);
  writeFileSync(join(root, 'b.md'), 'two'); expect(() => capture(binding(), { maxFiles: 1 })).toThrow(/limit/i);
  const second = capture(); expect(second.revision).not.toBe(first.revision);
  writeFileSync(join(root, 'b.md'), 'new'); expect(capture().revision).not.toBe(second.revision);
});

it('rejects malformed subjects and a mismatched manifest identity', () => {
  const subject = binding();
  expect(() => capture({ ...subject, pluginId: '../reader' })).toThrow(/invalid/i);
  writeFileSync(join(root, '.mindos/plugins/reader/manifest.json'), JSON.stringify({ id: 'other' }));
  expect(() => capture(binding())).toThrow(/identity/i);
});

it('requires an executable package entrypoint before serving Vault data', () => {
  rmSync(join(root, '.mindos/plugins/reader/main.js'));
  expect(() => capture()).toThrow(/entrypoint/i);
});

it('uses the same 64-segment boundary as the browser reader, including the filename', () => {
  const parent = Array(63).fill('d').join('/'); mkdirSync(join(root, parent), { recursive: true });
  writeFileSync(join(root, parent, 'note.md'), 'ok'); expect(capture().files).toHaveLength(1);
  mkdirSync(join(root, parent, 'child')); writeFileSync(join(root, parent, 'child/note.md'), 'too deep');
  expect(() => capture()).toThrow(/path limit/i);
});
