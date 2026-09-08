import { createHash } from 'node:crypto';
import { lstatSync, opendirSync, realpathSync } from 'node:fs';
import { knowledgeRootIdentity } from './knowledge-root-identity.js';
import { checkedSnapshotPath, readSnapshotFile } from './snapshot-file-reader.js';

type Limits = { maxFileBytes: number; maxTotalBytes: number; maxFiles: number };
export type PluginPackageFile = Readonly<{ path: string; size: number; sha256: string; base64: string }>;
export type PluginPackageSnapshot = Readonly<{ vaultId: string; fingerprint: string; files: readonly PluginPackageFile[]; totalBytes: number }>;
const LIMITS: Limits = { maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxFiles: 1024 };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function* directoryNames(directory: string): Generator<string> {
  const handle = opendirSync(directory);
  try {
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) yield entry.name;
  } finally { handle.closeSync(); }
}

/** Captures bytes, never executes code. The returned immutable bytes are the approval subject. */
export function readPluginPackageSnapshot(mindRoot: string, location: string, overrides: Partial<Limits> = {}): PluginPackageSnapshot {
  if (typeof location !== 'string' || !/^(?:\.mindos\/plugins|\.plugins)\/[a-zA-Z0-9_-]{1,64}$/.test(location)) {
    throw new Error('Invalid plugin package location');
  }
  const limits = { ...LIMITS, ...overrides };
  for (const key of Object.keys(LIMITS) as Array<keyof Limits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > LIMITS[key]) throw new Error('Invalid package limit');
  }
  const root = realpathSync(mindRoot);
  const vaultId = knowledgeRootIdentity(root);
  function checkedPath(parts: string[]): string {
    return checkedSnapshotPath(root, parts);
  }
  const prefix = location.split('/');
  try { checkedPath(prefix); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw Object.assign(new Error('Plugin package not found'), { code: 'PLUGIN_PACKAGE_NOT_FOUND' });
  }
  const files: PluginPackageFile[] = [];
  let totalBytes = 0;
  let entries = 0;
  function walk(parts: string[]): void {
    if (parts.length > 16) throw new Error('Plugin package depth limit exceeded');
    const directory = checkedPath([...prefix, ...parts]);
    if (!lstatSync(directory).isDirectory()) throw new Error('Plugin package path must be a directory');
    for (const name of directoryNames(directory)) {
      if (++entries > 2048) throw new Error('Plugin package entry limit exceeded');
      if (/[\\:\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('Invalid plugin asset path');
      // Obsidian loadData/saveData is a separate, mutable authority. Never include
      // user settings or credentials in a code download/approval fingerprint.
      if (parts.length === 0 && name === 'data.json') continue;
      const relativeParts = [...parts, name];
      const target = checkedPath([...prefix, ...relativeParts]);
      const stat = lstatSync(target);
      if (stat.isDirectory()) { walk(relativeParts); continue; }
      if (!stat.isFile()) throw new Error('Plugin package contains a non-regular asset');
      if (stat.nlink !== 1) throw new Error('Plugin package hard link is not allowed');
      if (files.length >= limits.maxFiles || stat.size > limits.maxFileBytes || stat.size > limits.maxTotalBytes - totalBytes) {
        throw new Error('Plugin package size/count limit exceeded');
      }
      const { bytes } = readSnapshotFile(root, [...prefix, ...relativeParts], Math.min(limits.maxFileBytes, limits.maxTotalBytes - totalBytes));
      files.push(Object.freeze({ path: relativeParts.join('/'), size: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') }));
      totalBytes += bytes.length;
    }
  }
  walk([]);
  if (vaultId !== knowledgeRootIdentity(mindRoot)) throw new Error('Knowledge root changed while reading plugin package');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const fingerprint = hash(JSON.stringify(['mindos-plugin-package-v1', files.map(({ path, size, sha256 }) => [path, size, sha256])]));
  return Object.freeze({ vaultId, fingerprint, files: Object.freeze(files), totalBytes });
}
