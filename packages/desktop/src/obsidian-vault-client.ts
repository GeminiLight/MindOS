import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { managedObsidianBaseUrl, readObsidianJson, untilAbort } from './obsidian-response';

export type VerifiedVault = Readonly<{ vaultId: string; pluginFingerprint: string; name: string; revision: string;
  totalBytes: number; folders: readonly string[]; files: readonly Readonly<{ path: string; base64: string; sha256: string;
    stat: Readonly<{ ctime: number; mtime: number; size: number }> }>[] }>;
type Options = { baseUrl: string; token: string; pluginId: string; vaultId: string; fingerprint: string;
  signal: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number };
const SHA = /^[a-f0-9]{64}$/;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const invalid = () => new Error('Invalid or changed plugin Vault snapshot.');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function pathKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(value)
    || value.split('/').length > 64 || value.split('/').some(part => !part || part.startsWith('.'))) throw invalid();
  return value;
}
/** Own in main only; renderer receives validated data, never this authenticated reader. */
export function createObsidianVaultClient(options: Options) {
  const base = managedObsidianBaseUrl(options.baseUrl); const { token, pluginId, vaultId, fingerprint, signal } = options;
  if (typeof token !== 'string' || !token || !/^[a-zA-Z0-9_-]{1,64}$/.test(pluginId) || !SHA.test(vaultId) || !SHA.test(fingerprint)) throw invalid();
  const timeoutMs = options.timeoutMs ?? 10_000; const fetchImpl = options.fetchImpl ?? fetch;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw invalid();
  return Object.freeze({ async read(): Promise<VerifiedVault> {
    signal.throwIfAborted();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const url = new URL('/api/obsidian-plugins/vault', base);
    for (const [key, value] of Object.entries({ pluginId, vaultId, fingerprint })) url.searchParams.set(key, value);
    const response = await untilAbort(fetchImpl(url, { method: 'GET', redirect: 'error', signal: deadline,
      headers: { authorization: `Bearer ${token}`, 'x-mindos-agent': `obsidian:${pluginId}` } }), deadline);
    // 64 MiB binary + base64 expansion + bounded path/stat metadata.
    const data = await readObsidianJson(response, 120 * 1024 * 1024, deadline, 'Plugin Vault');
    if (!response.ok) throw new Error(`Plugin Vault request failed (${response.status}).`);
    if (data.vaultId !== vaultId || data.pluginFingerprint !== fingerprint || typeof data.name !== 'string'
      || !data.name || data.name.length > 256 || /[\x00-\x1f\x7f]/.test(data.name)
      || !Array.isArray(data.files) || data.files.length > 10_000 || !Array.isArray(data.folders) || data.folders.length > 20_000) throw invalid();
    let previous = ''; const paths = new Set<string>();
    const folders = Array.from(data.folders, value => {
      const path = pathKey(value); if (path <= previous) throw invalid(); previous = path; paths.add(path); return path;
    });
    let totalBytes = 0; previous = '';
    const files = Array.from(data.files, value => {
      const file = record(value); const path = pathKey(file.path); const stat = record(file.stat);
      if (path <= previous || paths.has(path) || !Number.isSafeInteger(stat.size) || (stat.size as number) < 0 || (stat.size as number) > 2 * 1024 * 1024
        || typeof stat.ctime !== 'number' || !Number.isFinite(stat.ctime) || stat.ctime < 0
        || typeof stat.mtime !== 'number' || !Number.isFinite(stat.mtime) || stat.mtime < 0
        || typeof file.sha256 !== 'string' || !SHA.test(file.sha256) || typeof file.base64 !== 'string'
        || file.base64.length !== 4 * Math.ceil((stat.size as number) / 3)) throw invalid();
      previous = path; paths.add(path); totalBytes += stat.size as number;
      if (totalBytes > 64 * 1024 * 1024) throw invalid();
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.length !== stat.size || bytes.toString('base64') !== file.base64 || hash(bytes) !== file.sha256) throw invalid();
      return Object.freeze({ path, base64: file.base64, sha256: file.sha256,
        stat: Object.freeze({ ctime: stat.ctime, mtime: stat.mtime, size: stat.size as number }) });
    });
    const directories = new Set(folders);
    for (const path of paths) {
      const parts = path.split('/'); parts.pop();
      if (parts.length && !directories.has(parts.join('/'))) throw invalid();
    }
    const revision = hash(JSON.stringify(['mindos-plugin-vault-v1', vaultId, folders, files.map(f => [f.path, f.sha256, f.stat.ctime, f.stat.mtime, f.stat.size])]));
    if (revision !== data.revision || totalBytes !== data.totalBytes) throw invalid();
    deadline.throwIfAborted();
    return Object.freeze({ vaultId, pluginFingerprint: fingerprint, name: data.name, revision, totalBytes,
      folders: Object.freeze(folders), files: Object.freeze(files) });
  } });
}
