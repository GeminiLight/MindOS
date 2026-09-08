import { createHash } from 'node:crypto';
import { lstatSync, opendirSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { readPluginPackageSnapshot } from './plugin-package-snapshot.js';
import { knowledgeRootIdentity } from './knowledge-root-identity.js';
import { checkedSnapshotPath, readSnapshotFile } from './snapshot-file-reader.js';

type Subject = Readonly<{ pluginId: string; vaultId: string; fingerprint: string }>;
type Limits = { maxFileBytes: number; maxTotalBytes: number; maxFiles: number };
const LIMITS: Limits = { maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxFiles: 10_000 };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type PluginVaultFile = Readonly<{ path: string; base64: string; sha256: string; stat: Readonly<{ ctime: number; mtime: number; size: number }> }>;
export type PluginVaultSnapshot = Readonly<{ vaultId: string; pluginFingerprint: string; name: string; revision: string;
  totalBytes: number; files: readonly PluginVaultFile[]; folders: readonly string[] }>;

/** The authenticated caller must obtain native consent BEFORE invoking this reader. */
export function readPluginVaultSnapshot(mindRoot: string, subject: Subject, overrides: Partial<Limits> = {}): PluginVaultSnapshot {
  if (!subject || !/^[a-zA-Z0-9_-]{1,64}$/.test(subject.pluginId) || !/^[a-f0-9]{64}$/.test(subject.vaultId)
    || !/^[a-f0-9]{64}$/.test(subject.fingerprint)) throw new Error('Invalid Vault approval subject');
  const limits = { ...LIMITS, ...overrides };
  for (const key of Object.keys(LIMITS) as Array<keyof Limits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > LIMITS[key]) throw new Error('Invalid Vault snapshot limit');
  }
  const checkPackage = () => {
    let code;
    try { code = readPluginPackageSnapshot(mindRoot, `.mindos/plugins/${subject.pluginId}`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'PLUGIN_PACKAGE_NOT_FOUND') throw error;
      code = readPluginPackageSnapshot(mindRoot, `.plugins/${subject.pluginId}`);
    }
    if (code.vaultId !== subject.vaultId || code.fingerprint !== subject.fingerprint) {
      throw Object.assign(new Error('Approved plugin or Vault changed'), { code: 'VAULT_SUBJECT_CHANGED' });
    }
    const manifest = code.files.find(file => file.path === 'manifest.json');
    if (!code.files.some(file => file.path === 'main.js')) throw new Error('Plugin entrypoint missing');
    if (!manifest || manifest.size > 64 * 1024 || JSON.parse(Buffer.from(manifest.base64, 'base64').toString('utf8')).id !== subject.pluginId) {
      throw new Error('Plugin manifest identity mismatch');
    }
  };
  checkPackage();
  const root = realpathSync(mindRoot); const files: PluginVaultFile[] = []; const folders: string[] = [];
  let totalBytes = 0; let entries = 0;
  function walk(parts: string[]) {
    if (parts.length > 64) throw new Error('Vault depth limit exceeded');
    const path = checkedSnapshotPath(root, parts);
    if (!lstatSync(path).isDirectory()) throw new Error('Vault directory changed');
    const directory = opendirSync(path);
    try {
      for (let item = directory.readSync(); item; item = directory.readSync()) {
        if (++entries > 40_000) throw new Error('Vault entry limit exceeded');
        if (item.name.startsWith('.')) continue;
        const child = [...parts, item.name]; const relative = child.join('/');
        if (relative.length > 1024 || child.length > 64) throw new Error('Vault path limit exceeded');
        const stat = lstatSync(checkedSnapshotPath(root, child));
        if (stat.isDirectory()) {
          if (folders.length >= 20_000) throw new Error('Vault directory limit exceeded');
          folders.push(relative); walk(child); continue;
        }
        if (files.length >= limits.maxFiles) throw new Error('Vault file count limit exceeded');
        const { bytes, stat: opened } = readSnapshotFile(root, child, Math.min(limits.maxFileBytes, limits.maxTotalBytes - totalBytes));
        totalBytes += bytes.length;
        files.push(Object.freeze({ path: relative, base64: bytes.toString('base64'), sha256: sha(bytes),
          stat: Object.freeze({ ctime: opened.birthtimeMs, mtime: opened.mtimeMs, size: bytes.length }) }));
      }
    } finally { directory.closeSync(); }
  }
  walk([]); checkPackage();
  if (knowledgeRootIdentity(mindRoot) !== subject.vaultId) throw new Error('Vault changed during snapshot');
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  files.sort((a, b) => compare(a.path, b.path)); folders.sort(compare);
  const revision = sha(JSON.stringify(['mindos-plugin-vault-v1', subject.vaultId, folders,
    files.map(file => [file.path, file.sha256, file.stat.ctime, file.stat.mtime, file.stat.size])]));
  return Object.freeze({ vaultId: subject.vaultId, pluginFingerprint: subject.fingerprint, name: basename(root), revision,
    totalBytes, files: Object.freeze(files), folders: Object.freeze(folders) });
}
