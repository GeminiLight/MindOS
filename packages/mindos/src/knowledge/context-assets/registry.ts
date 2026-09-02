import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { redactSensitiveObject } from '../../agent/redaction.js';
import {
  CONTEXT_ASSET_KINDS,
  type ContextAsset,
  type ContextAssetKind,
  type ContextAssetRegistry,
  type ContextAssetSource,
  type ContextAssetStatus,
  type ListContextAssetsOptions,
  type RegisterContextAssetInput,
  type RegisterContextFileAssetInput,
} from './types.js';

export const CONTEXT_ASSET_REGISTRY_FILE = '.mindos/context-assets/registry.json';

const REGISTRY_DIR = '.mindos/context-assets';
const REGISTRY_LOCK = `${REGISTRY_DIR}/registry.lock`;
const SCHEMA_VERSION = 1;
const MAX_ASSETS = 10_000;
const MAX_METADATA_CHARS = 8_000;
const LOCK_ATTEMPTS = 50;
const LOCK_WAIT_MS = 10;
const STALE_LOCK_MS = 30_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function readContextAssetRegistry(mindRoot: string): ContextAssetRegistry {
  try {
    const file = resolveExistingSafe(mindRoot, CONTEXT_ASSET_REGISTRY_FILE);
    if (!existsSync(file)) return emptyRegistry();
    return normalizeRegistry(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return emptyRegistry();
  }
}

export function listContextAssets(
  mindRoot: string,
  options: ListContextAssetsOptions = {},
): ContextAsset[] {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(1_000, Math.floor(options.limit!)))
    : 200;
  return readContextAssetRegistry(mindRoot).assets
    .filter((asset) => !options.kind || asset.kind === options.kind)
    .filter((asset) => !options.status || asset.status === options.status)
    .filter((asset) => !options.sourceRef || asset.source.ref === options.sourceRef)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function registerContextFileAsset(
  mindRoot: string,
  input: RegisterContextFileAssetInput,
  now = new Date(),
): ContextAsset {
  const normalizedPath = normalizeRelativePath(input.path);
  const file = resolveExistingSafe(mindRoot, normalizedPath);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`Context asset file not found: ${normalizedPath}`);
  }
  const content = readFileSync(file);
  return registerContextAsset(mindRoot, {
    kind: input.kind ?? inferAssetKind(normalizedPath),
    status: input.status ?? 'active',
    title: normalizeText(input.title, 200) || path.basename(normalizedPath, path.extname(normalizedPath)),
    path: normalizedPath,
    contentHash: crypto.createHash('sha256').update(content).digest('hex'),
    source: input.source ?? { kind: 'file', ref: `file:${normalizedPath}` },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, now);
}

export function registerContextAsset(
  mindRoot: string,
  input: RegisterContextAssetInput,
  now = new Date(),
): ContextAsset {
  const normalized = normalizeRegisterInput(input);
  return withRegistryLock(mindRoot, () => {
    const registry = readContextAssetRegistryUnlocked(mindRoot);
    const idIndex = registry.assets.findIndex((asset) => asset.id === normalized.id);
    const sourceIndex = registry.assets.findIndex((asset) => asset.source.ref === normalized.source.ref);
    if (idIndex >= 0 && sourceIndex >= 0 && idIndex !== sourceIndex) {
      throw new Error('Context asset ownership collision between id and source ref.');
    }
    const existingIndex = idIndex >= 0 ? idIndex : sourceIndex;
    const existing = existingIndex >= 0 ? registry.assets[existingIndex] : undefined;
    if (existing && (
      existing.id !== normalized.id
      || existing.source.kind !== normalized.source.kind
      || existing.source.ref !== normalized.source.ref
    )) {
      throw new Error('Context asset ownership collision: id and source ref are immutable.');
    }
    if (existing && sameAssetContent(existing, normalized)) return existing;

    const timestamp = now.toISOString();
    const next: ContextAsset = existing
      ? {
          ...existing,
          ...normalized,
          id: existing.id,
          version: existing.contentHash === normalized.contentHash ? existing.version : existing.version + 1,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        }
      : {
          ...normalized,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

    if (existingIndex >= 0) registry.assets[existingIndex] = next;
    else registry.assets.unshift(next);
    registry.assets = registry.assets.slice(0, MAX_ASSETS);
    registry.updatedAt = timestamp;
    writeRegistryUnlocked(mindRoot, registry);
    return next;
  });
}

export function updateContextAssetStatus(
  mindRoot: string,
  assetId: string,
  status: ContextAssetStatus,
  now = new Date(),
): ContextAsset | null {
  const id = normalizeId(assetId);
  const nextStatus = normalizeStatus(status);
  return withRegistryLock(mindRoot, () => {
    const registry = readContextAssetRegistryUnlocked(mindRoot);
    const index = registry.assets.findIndex((asset) => asset.id === id);
    if (index < 0) return null;
    const current = registry.assets[index]!;
    if (current.status === nextStatus) return current;
    const next = { ...current, status: nextStatus, updatedAt: now.toISOString() };
    registry.assets[index] = next;
    registry.updatedAt = next.updatedAt;
    writeRegistryUnlocked(mindRoot, registry);
    return next;
  });
}

export function removeContextAsset(mindRoot: string, assetId: string, now = new Date()): boolean {
  const id = normalizeId(assetId);
  return withRegistryLock(mindRoot, () => {
    const registry = readContextAssetRegistryUnlocked(mindRoot);
    const next = registry.assets.filter((asset) => asset.id !== id);
    if (next.length === registry.assets.length) return false;
    registry.assets = next;
    registry.updatedAt = now.toISOString();
    writeRegistryUnlocked(mindRoot, registry);
    return true;
  });
}

function emptyRegistry(): ContextAssetRegistry {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date(0).toISOString(), assets: [] };
}

function readContextAssetRegistryUnlocked(mindRoot: string): ContextAssetRegistry {
  const file = resolveExistingSafe(mindRoot, CONTEXT_ASSET_REGISTRY_FILE);
  if (!existsSync(file)) return emptyRegistry();
  try {
    return normalizeRegistry(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    throw new Error('Context asset registry is corrupt; the original file was preserved.');
  }
}

function writeRegistryUnlocked(mindRoot: string, registry: ContextAssetRegistry): void {
  const file = resolveExistingSafe(mindRoot, CONTEXT_ASSET_REGISTRY_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function withRegistryLock<T>(mindRoot: string, operation: () => T): T {
  const directory = resolveExistingSafe(mindRoot, REGISTRY_DIR);
  mkdirSync(directory, { recursive: true });
  const lock = resolveExistingSafe(mindRoot, REGISTRY_LOCK);
  acquireDirectoryLock(lock);
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function acquireDirectoryLock(lock: string): void {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(path.join(lock, 'owner'), `${process.pid}\n${Date.now()}\n`, { encoding: 'utf-8', mode: 0o600 });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (isStaleLock(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
    }
  }
  throw new Error('Context asset registry is busy; retry shortly.');
}

function isStaleLock(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function normalizeRegistry(value: unknown): ContextAssetRegistry {
  const record = isRecord(value) ? value : {};
  const assets = Array.isArray(record.assets)
    ? record.assets.map(normalizeStoredAsset).filter((asset): asset is ContextAsset => asset !== null).slice(0, MAX_ASSETS)
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: validIso(record.updatedAt) ?? new Date(0).toISOString(),
    assets,
  };
}

function normalizeStoredAsset(value: unknown): ContextAsset | null {
  if (!isRecord(value)) return null;
  try {
    const source = normalizeSource(value.source);
    return {
      id: normalizeId(value.id),
      kind: normalizeKind(value.kind),
      status: normalizeStatus(value.status),
      title: normalizeRequiredText(value.title, 200, 'title'),
      path: normalizeRelativePath(value.path),
      contentHash: normalizeContentHash(value.contentHash),
      version: typeof value.version === 'number' && Number.isFinite(value.version)
        ? Math.max(1, Math.floor(value.version))
        : 1,
      source,
      createdAt: validIso(value.createdAt) ?? new Date(0).toISOString(),
      updatedAt: validIso(value.updatedAt) ?? new Date(0).toISOString(),
      ...(isRecord(value.metadata) ? { metadata: boundedMetadata(value.metadata) } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeRegisterInput(input: RegisterContextAssetInput): Omit<ContextAsset, 'version' | 'createdAt' | 'updatedAt'> {
  const source = normalizeSource(input.source);
  return {
    id: input.id ? normalizeId(input.id) : `asset-${crypto.createHash('sha256').update(source.ref).digest('hex').slice(0, 20)}`,
    kind: normalizeKind(input.kind),
    status: normalizeStatus(input.status),
    title: normalizeRequiredText(input.title, 200, 'title'),
    path: normalizeRelativePath(input.path),
    contentHash: normalizeContentHash(input.contentHash),
    source,
    ...(input.metadata ? { metadata: boundedMetadata(input.metadata) } : {}),
  };
}

function sameAssetContent(existing: ContextAsset, next: Omit<ContextAsset, 'version' | 'createdAt' | 'updatedAt'>): boolean {
  return existing.kind === next.kind
    && existing.status === next.status
    && existing.title === next.title
    && existing.path === next.path
    && existing.contentHash === next.contentHash
    && existing.source.kind === next.source.kind
    && existing.source.ref === next.source.ref
    && JSON.stringify(existing.metadata ?? {}) === JSON.stringify(next.metadata ?? {});
}

function normalizeKind(value: unknown): ContextAssetKind {
  if (typeof value === 'string' && CONTEXT_ASSET_KINDS.includes(value as ContextAssetKind)) return value as ContextAssetKind;
  throw new Error('Unsupported context asset kind.');
}

function normalizeStatus(value: unknown): ContextAssetStatus {
  if (value === 'draft' || value === 'active' || value === 'deprecated') return value;
  throw new Error('Unsupported context asset status.');
}

function normalizeSource(value: unknown): ContextAssetSource {
  if (!isRecord(value)) throw new Error('Context asset source is required.');
  const kind = value.kind;
  if (kind !== 'file' && kind !== 'echo-card' && kind !== 'skill' && kind !== 'workflow' && kind !== 'automation-run') {
    throw new Error('Unsupported context asset source kind.');
  }
  return {
    kind,
    ref: normalizeRequiredText(value.ref, 500, 'source ref'),
  };
}

function normalizeId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_ID.test(id)) throw new Error('Context asset id is invalid.');
  return id;
}

function normalizeContentHash(value: unknown): string {
  const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256.test(hash)) throw new Error('Context asset contentHash must be SHA-256.');
  return hash;
}

function normalizeRelativePath(value: unknown): string {
  const raw = normalizeRequiredText(value, 1_000, 'path').replace(/\\/g, '/');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) throw new Error('Context asset path must be relative.');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Context asset relative path must stay inside mindRoot.');
  }
  return normalized;
}

function inferAssetKind(filePath: string): ContextAssetKind {
  if (/^(?:\.mindos\/)?skills\//i.test(filePath)) return 'skill';
  if (/^\.mindos\/workflows\//i.test(filePath)) return 'workflow';
  return 'knowledge';
}

function normalizeRequiredText(value: unknown, max: number, label: string): string {
  const normalized = normalizeText(value, max);
  if (!normalized) throw new Error(`Context asset ${label} is required.`);
  return normalized;
}

function normalizeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function boundedMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSensitiveObject(value);
  const raw = JSON.stringify(redacted);
  if (raw.length <= MAX_METADATA_CHARS) return redacted;
  return { truncated: true, preview: raw.slice(0, MAX_METADATA_CHARS) };
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
