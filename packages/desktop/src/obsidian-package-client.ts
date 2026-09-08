import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { managedObsidianBaseUrl, readObsidianJson, untilAbort } from './obsidian-response';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Asset = Readonly<{ path: string; size: number; sha256: string }>;
type PackageManifest = Readonly<{ id: string; name: string; version: string; minAppVersion?: string; isDesktopOnly?: boolean }>;
export type PackagePreview = Readonly<{
  manifest: PackageManifest; vaultId: string; fingerprint: string; totalBytes: number; assets: readonly Asset[];
}>;
export type VerifiedPackage = PackagePreview & Readonly<{ files: readonly (Asset & Readonly<{ base64: string }>)[] }>;
type ClientOptions = {
  baseUrl: string; token: string; pluginId: string; signal: AbortSignal;
  fetchImpl?: typeof fetch; timeoutMs?: number;
};

/** A bounded, main-process-only reader. It neither evaluates code nor grants permission. */
export function createObsidianPackageClient(options: ClientOptions) {
  const base = managedObsidianBaseUrl(options.baseUrl);
  const { token, pluginId, signal } = options;
  if (typeof token !== 'string' || !token) throw new Error('Missing local server authentication.');
  if (typeof pluginId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(pluginId)) throw new Error('Invalid plugin id.');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid package request timeout.');
  const fetchImpl = options.fetchImpl ?? fetch;
  async function request(expected?: PackagePreview): Promise<unknown> {
    signal.throwIfAborted();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const url = new URL('/api/obsidian-plugins/package', base);
    url.searchParams.set('pluginId', pluginId);
    if (expected) { url.searchParams.set('fingerprint', expected.fingerprint); url.searchParams.set('vaultId', expected.vaultId); }
    const response = await untilAbort(fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: deadline,
      headers: { authorization: `Bearer ${token}`, 'x-mindos-agent': `obsidian:${pluginId}` },
    }), deadline);
    // Base64 expands a 64 MiB package by 4/3. Preview metadata has its own smaller cap.
    const data = await readObsidianJson(response, expected ? 90 * 1024 * 1024 : 1024 * 1024, deadline, 'Plugin package');
    if (!response.ok) throw new Error(`Plugin package ${typeof data.error === 'string' ? data.error.slice(0, 160) : 'request failed'} (${response.status}).`);
    return data;
  }
  return Object.freeze({
    preview: async () => validatePreview(await request(), pluginId),
    download: async (expected: PackagePreview): Promise<VerifiedPackage> => {
      const raw = record(await request(expected));
      const preview = validatePreview(raw, pluginId);
      assertSamePackage(preview, expected);
      if (!Array.isArray(raw.files) || raw.files.length !== preview.assets.length) throw new Error('Invalid package files.');
      const files = preview.assets.map((asset, index) => {
        const file = record((raw.files as unknown[])[index]);
        if (file.path !== asset.path || file.size !== asset.size || file.sha256 !== asset.sha256 || typeof file.base64 !== 'string'
          || file.base64.length !== 4 * Math.ceil(asset.size / 3)) throw new Error('Invalid package asset bytes.');
        const bytes = Buffer.from(file.base64, 'base64');
        if (bytes.length !== asset.size || bytes.toString('base64') !== file.base64 || hash(bytes) !== asset.sha256) throw new Error('Package asset digest mismatch.');
        if (asset.path === 'manifest.json') {
          const parsed = readManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), pluginId);
          if (JSON.stringify(parsed) !== JSON.stringify(preview.manifest)) throw new Error('Package manifest differs from approval.');
        }
        if (asset.path === 'main.js') new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return Object.freeze({ ...asset, base64: file.base64 });
      });
      return Object.freeze({ ...preview, files: Object.freeze(files) });
    },
  });
}

export function assertSamePackage(actual: PackagePreview, expected: PackagePreview): void {
  if (actual.vaultId !== expected.vaultId) throw new Error('Plugin package vault changed.');
  if (actual.fingerprint !== expected.fingerprint || JSON.stringify(actual.manifest) !== JSON.stringify(expected.manifest)) {
    throw new Error('Approved plugin package changed.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plugin package response.');
  return value as Record<string, unknown>;
}

function readManifest(value: unknown, pluginId: string): PackageManifest {
  const data = record(value);
  if (data.id !== pluginId || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 256
    || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(data.name)
    || typeof data.version !== 'string' || data.version.length > 64 || !/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error('Invalid plugin package manifest.');
  if (data.minAppVersion !== undefined && (typeof data.minAppVersion !== 'string' || data.minAppVersion.length > 64)) throw new Error('Invalid package minAppVersion.');
  if (data.isDesktopOnly !== undefined && typeof data.isDesktopOnly !== 'boolean') throw new Error('Invalid package platform flag.');
  return Object.freeze({ id: pluginId, name: data.name, version: data.version,
    ...(data.minAppVersion !== undefined ? { minAppVersion: data.minAppVersion as string } : {}),
    ...(data.isDesktopOnly !== undefined ? { isDesktopOnly: data.isDesktopOnly as boolean } : {}),
  });
}

function validatePreview(value: unknown, pluginId: string): PackagePreview {
  const data = record(value);
  if (typeof data.vaultId !== 'string' || !SHA256.test(data.vaultId) || typeof data.fingerprint !== 'string' || !SHA256.test(data.fingerprint)
    || !Number.isSafeInteger(data.totalBytes) || (data.totalBytes as number) < 0 || (data.totalBytes as number) > MAX_TOTAL
    || !Array.isArray(data.assets) || data.assets.length < 2 || data.assets.length > 1024) throw new Error('Invalid plugin package metadata.');
  let total = 0; let previous = '';
  const assets = data.assets.map(value => {
    const asset = record(value);
    if (typeof asset.path !== 'string' || asset.path.length > 4096 || asset.path <= previous || asset.path === 'data.json'
      || /[\\:\x00-\x1f]/.test(asset.path) || asset.path.split('/').some(part => !part || part === '.' || part === '..')
      || !Number.isSafeInteger(asset.size) || (asset.size as number) < 0 || (asset.size as number) > MAX_FILE
      || typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) throw new Error('Invalid plugin package asset metadata.');
    previous = asset.path; total += asset.size as number;
    return Object.freeze({ path: asset.path, size: asset.size as number, sha256: asset.sha256 });
  });
  const manifest = assets.find(asset => asset.path === 'manifest.json');
  if (!manifest || manifest.size > 64 * 1024 || !assets.some(asset => asset.path === 'main.js') || total !== data.totalBytes) throw new Error('Invalid package entrypoints or total size.');
  const fingerprint = hash(JSON.stringify(['mindos-plugin-package-v1', assets.map(({ path, size, sha256 }) => [path, size, sha256])]));
  if (fingerprint !== data.fingerprint) throw new Error('Plugin package fingerprint mismatch.');
  return Object.freeze({ manifest: readManifest(data.manifest, pluginId), vaultId: data.vaultId, fingerprint,
    totalBytes: total, assets: Object.freeze(assets) });
}
