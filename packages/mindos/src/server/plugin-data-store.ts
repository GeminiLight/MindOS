import { isSafePluginIdentifier } from '../foundation/plugins/safe-id.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPluginPackageSnapshot } from './plugin-package-snapshot.js';
import { checkedSnapshotPath, readSnapshotFile } from './snapshot-file-reader.js';

export type PluginDataBinding = { pluginId: string; vaultId: string; fingerprint: string };
export type PluginDataSnapshot = { data: unknown; revision: string };
const MAX_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const revision = (bytes: Buffer | null) => createHash('sha256').update(bytes === null ? 'missing' : Buffer.concat([Buffer.from('json:'), bytes])).digest('hex');

function approvedDirectory(mindRoot: string, binding: PluginDataBinding) {
  if (!binding || !isSafePluginIdentifier(binding.pluginId, { allowDots: false }) || !SHA256.test(binding.vaultId) || !SHA256.test(binding.fingerprint)) {
    throw new Error('Invalid plugin data binding');
  }
  const root = realpathSync(mindRoot);
  let location = `.mindos/plugins/${binding.pluginId}`;
  let snapshot;
  try { snapshot = readPluginPackageSnapshot(root, location); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'PLUGIN_PACKAGE_NOT_FOUND') throw error;
    location = `.plugins/${binding.pluginId}`;
    snapshot = readPluginPackageSnapshot(root, location);
  }
  if (snapshot.vaultId !== binding.vaultId) throw new Error('Plugin data vault changed');
  if (snapshot.fingerprint !== binding.fingerprint) throw new Error('Approved plugin package changed');
  const parts = location.split('/');
  return { root, parts, directory: checkedSnapshotPath(root, parts) };
}

function readData(root: string, parts: string[]): PluginDataSnapshot {
  let bytes: Buffer;
  try { bytes = readSnapshotFile(root, [...parts, 'data.json'], MAX_BYTES).bytes; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { data: null, revision: revision(null) };
    throw error;
  }
  try { return { data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), revision: revision(bytes) }; }
  catch { throw new Error('Plugin configuration contains invalid JSON'); }
}

export function readPluginData(mindRoot: string, binding: PluginDataBinding): PluginDataSnapshot {
  const { root, parts } = approvedDirectory(mindRoot, binding);
  return readData(root, parts);
}

/** Same-process serialized, optimistic write. Cross-process filesystem CAS is not claimed. */
export function writePluginData(mindRoot: string, binding: PluginDataBinding, expectedRevision: string, data: unknown): PluginDataSnapshot {
  if (typeof expectedRevision !== 'string' || !SHA256.test(expectedRevision)) throw new Error('Invalid plugin data revision');
  let json: string | undefined;
  try {
    json = JSON.stringify(data, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value) || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
        throw new Error('Invalid JSON value');
      }
      return value;
    }, 2);
  } catch { throw new Error('Plugin configuration must contain JSON values'); }
  if (json === undefined) throw new Error('Plugin configuration must contain JSON values');
  const bytes = Buffer.from(json);
  if (bytes.length > MAX_BYTES) throw new Error('Plugin configuration size limit exceeded');
  const { root, parts, directory } = approvedDirectory(mindRoot, binding);
  const current = readData(root, parts);
  if (current.revision !== expectedRevision) throw Object.assign(new Error('Plugin configuration conflict; reopen settings to load the current data'), { code: 'PLUGIN_DATA_CONFLICT' });
  const before = lstatSync(directory);
  const temporary = join(directory, `.data-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    const after = lstatSync(checkedSnapshotPath(root, parts));
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('Plugin directory changed during configuration save');
    // Detect a writer that changed data while our temporary file was being prepared.
    if (readData(root, parts).revision !== expectedRevision) throw Object.assign(new Error('Plugin configuration conflict'), { code: 'PLUGIN_DATA_CONFLICT' });
    renameSync(temporary, join(directory, 'data.json'));
  } finally { rmSync(temporary, { force: true }); }
  return { data: JSON.parse(json), revision: revision(bytes) };
}
