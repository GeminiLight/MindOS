import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  assertSafeObsidianPluginId,
  resolveCanonicalPluginDesktopSecretStoragePath,
  resolveCanonicalPluginSecretStorageKeyPath,
  resolveCanonicalPluginSecretStoragePath,
} from './plugin-paths';

const SECRET_ID_PATTERN = /^[a-z0-9-]+$/;
const SECRET_STORAGE_VERSION = 1;
const SECRET_STORAGE_BACKEND = 'local-aes-256-gcm-file';
const DESKTOP_SAFE_STORAGE_BACKEND = 'desktop-safe-storage-broker';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const DEFAULT_DESKTOP_BROKER_TIMEOUT_MS = 3000;
const DESKTOP_SECRET_BROKER_URL_ENV = 'MINDOS_OBSIDIAN_SECRET_BROKER_URL';
const DESKTOP_SECRET_BROKER_TOKEN_ENV = 'MINDOS_OBSIDIAN_SECRET_BROKER_TOKEN';

type MaybePromise<T> = T | Promise<T>;

interface StoredSecretEntry {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

interface SecretStorageFile {
  version: typeof SECRET_STORAGE_VERSION;
  backend: typeof SECRET_STORAGE_BACKEND;
  entries: Record<string, Record<string, StoredSecretEntry>>;
}

interface DesktopSafeStorageEntry {
  alg: 'electron-safe-storage';
  data: string;
  updatedAt: string;
}

interface DesktopSafeStorageFile {
  version: typeof SECRET_STORAGE_VERSION;
  backend: typeof DESKTOP_SAFE_STORAGE_BACKEND;
  entries: Record<string, Record<string, DesktopSafeStorageEntry>>;
}

export interface ObsidianSecretStorageSummary {
  backend: string;
  encrypted: boolean;
  pluginId: string;
  secrets: number;
  path?: string;
  keyPath?: string;
}

export interface SecretStorageHostWarning {
  pluginId?: string;
  code: string;
  message: string;
}

export type SecretStorageWarningSink = (warning: SecretStorageHostWarning) => void;

export interface ObsidianSecretStorageBackend {
  readonly backend: string;
  readonly encrypted: boolean;
  setSecret(pluginId: string, secretId: string, secret: string): MaybePromise<void>;
  getSecret(pluginId: string, secretId: string): MaybePromise<string | null>;
  listSecrets(pluginId: string): MaybePromise<string[]>;
  removePluginSecrets(pluginId: string): MaybePromise<number>;
  getSummary(pluginId: string): ObsidianSecretStorageSummary;
}

export interface DesktopSecretStorageBrokerConfig {
  url: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

class SecretStorageBackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SecretStorageBackendError';
  }
}

export class LocalAesGcmSecretStorageBackend implements ObsidianSecretStorageBackend {
  readonly backend = SECRET_STORAGE_BACKEND;
  readonly encrypted = true;

  constructor(private readonly mindRoot: string) {}

  setSecret(pluginId: string, secretId: string, secret: string): void {
    const store = this.readStore();
    const pluginEntries = store.entries[pluginId] ?? {};
    pluginEntries[secretId] = this.encrypt(secret);
    store.entries[pluginId] = pluginEntries;
    this.writeStore(store);
  }

  getSecret(pluginId: string, secretId: string): string | null {
    const entry = this.readStore().entries[pluginId]?.[secretId];
    if (!entry) return null;
    return this.decrypt(entry, secretId);
  }

  listSecrets(pluginId: string): string[] {
    return Object.keys(this.readStore().entries[pluginId] ?? {}).sort();
  }

  removePluginSecrets(pluginId: string): number {
    const store = this.readStore();
    const count = Object.keys(store.entries[pluginId] ?? {}).length;
    if (count === 0) return 0;
    delete store.entries[pluginId];
    this.writeStore(store);
    return count;
  }

  getSummary(pluginId: string): ObsidianSecretStorageSummary {
    return {
      backend: this.backend,
      encrypted: this.encrypted,
      path: relativeToMindRoot(this.mindRoot, this.storagePath()),
      keyPath: relativeToMindRoot(this.mindRoot, this.keyPath()),
      pluginId,
      secrets: Object.keys(this.readStore().entries[pluginId] ?? {}).length,
    };
  }

  private encrypt(secret: string): StoredSecretEntry {
    const key = this.readOrCreateKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
      updatedAt: new Date().toISOString(),
    };
  }

  private decrypt(entry: StoredSecretEntry, secretId: string): string {
    try {
      if (entry.alg !== 'aes-256-gcm') {
        throw new Error(`Unsupported algorithm: ${entry.alg}`);
      }
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.readOrCreateKey(),
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(entry.data, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf-8');
    } catch {
      throw new SecretStorageBackendError(
        'secret-storage-decrypt-failed',
        `[obsidian-compat] Failed to decrypt SecretStorage entry "${secretId}".`,
      );
    }
  }

  private readStore(): SecretStorageFile {
    const filePath = this.storagePath();
    if (!fs.existsSync(filePath)) {
      return emptyStore();
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<SecretStorageFile>;
      if (parsed.version !== SECRET_STORAGE_VERSION || parsed.backend !== SECRET_STORAGE_BACKEND) {
        return emptyStore();
      }
      return {
        version: SECRET_STORAGE_VERSION,
        backend: SECRET_STORAGE_BACKEND,
        entries: normalizeEntries(parsed.entries),
      };
    } catch {
      return emptyStore();
    }
  }

  private writeStore(store: SecretStorageFile): void {
    const filePath = this.storagePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
    chmodBestEffort(filePath);
  }

  private readOrCreateKey(): Buffer {
    const filePath = this.keyPath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      const key = Buffer.from(raw, 'base64');
      if (key.length !== KEY_BYTES) {
        throw new Error('[obsidian-compat] SecretStorage key has an invalid length.');
      }
      return key;
    }

    const key = crypto.randomBytes(KEY_BYTES);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, key.toString('base64'), { encoding: 'utf-8', mode: 0o600 });
    chmodBestEffort(filePath);
    return key;
  }

  private storagePath(): string {
    return resolveCanonicalPluginSecretStoragePath(this.mindRoot);
  }

  private keyPath(): string {
    return resolveCanonicalPluginSecretStorageKeyPath(this.mindRoot);
  }
}

export class DesktopSafeStorageBrokerBackend implements ObsidianSecretStorageBackend {
  readonly backend = DESKTOP_SAFE_STORAGE_BACKEND;
  readonly encrypted = true;
  private readonly brokerUrl: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly mindRoot: string,
    config: DesktopSecretStorageBrokerConfig,
  ) {
    this.brokerUrl = normalizeDesktopSecretBrokerUrl(config.url);
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_DESKTOP_BROKER_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (!this.token.trim()) {
      throw new Error('[obsidian-compat] Desktop SecretStorage broker token is required.');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('[obsidian-compat] Desktop SecretStorage broker requires fetch.');
    }
  }

  async setSecret(pluginId: string, secretId: string, secret: string): Promise<void> {
    const encrypted = await this.encrypt(secret);
    const store = this.readStore();
    const pluginEntries = store.entries[pluginId] ?? {};
    pluginEntries[secretId] = {
      alg: 'electron-safe-storage',
      data: encrypted,
      updatedAt: new Date().toISOString(),
    };
    store.entries[pluginId] = pluginEntries;
    this.writeStore(store);
  }

  async getSecret(pluginId: string, secretId: string): Promise<string | null> {
    const entry = this.readStore().entries[pluginId]?.[secretId];
    if (!entry) return null;
    if (entry.alg !== 'electron-safe-storage') {
      throw new Error('[obsidian-compat] Unsupported Desktop SecretStorage entry algorithm.');
    }
    return this.decrypt(entry.data);
  }

  listSecrets(pluginId: string): string[] {
    return Object.keys(this.readStore().entries[pluginId] ?? {}).sort();
  }

  removePluginSecrets(pluginId: string): number {
    const store = this.readStore();
    const count = Object.keys(store.entries[pluginId] ?? {}).length;
    if (count === 0) return 0;
    delete store.entries[pluginId];
    this.writeStore(store);
    return count;
  }

  getSummary(pluginId: string): ObsidianSecretStorageSummary {
    return {
      backend: this.backend,
      encrypted: this.encrypted,
      path: relativeToMindRoot(this.mindRoot, this.storagePath()),
      pluginId,
      secrets: Object.keys(this.readStore().entries[pluginId] ?? {}).length,
    };
  }

  private async encrypt(secret: string): Promise<string> {
    const result = await this.requestBroker<{ data: string }>('/v1/obsidian-secret-storage/encrypt', { plaintext: secret });
    if (typeof result.data !== 'string' || !result.data) {
      throw new Error('[obsidian-compat] Desktop SecretStorage broker returned an invalid encrypted payload.');
    }
    return result.data;
  }

  private async decrypt(data: string): Promise<string> {
    const result = await this.requestBroker<{ plaintext: string }>('/v1/obsidian-secret-storage/decrypt', { data });
    if (typeof result.plaintext !== 'string') {
      throw new Error('[obsidian-compat] Desktop SecretStorage broker returned an invalid plaintext payload.');
    }
    return result.plaintext;
  }

  private async requestBroker<T>(pathname: string, body: Record<string, unknown>): Promise<T> {
    const url = new URL(pathname, this.brokerUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`[obsidian-compat] Desktop SecretStorage broker returned HTTP ${response.status}.`);
      }
      const payload = await response.json() as { ok?: boolean; error?: string } & T;
      if (payload.ok !== true) {
        throw new Error('[obsidian-compat] Desktop SecretStorage broker rejected the request.');
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  private readStore(): DesktopSafeStorageFile {
    const filePath = this.storagePath();
    if (!fs.existsSync(filePath)) {
      return emptyDesktopSafeStorageStore();
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<DesktopSafeStorageFile>;
      if (parsed.version !== SECRET_STORAGE_VERSION || parsed.backend !== DESKTOP_SAFE_STORAGE_BACKEND) {
        return emptyDesktopSafeStorageStore();
      }
      return {
        version: SECRET_STORAGE_VERSION,
        backend: DESKTOP_SAFE_STORAGE_BACKEND,
        entries: normalizeDesktopSafeStorageEntries(parsed.entries),
      };
    } catch {
      return emptyDesktopSafeStorageStore();
    }
  }

  private writeStore(store: DesktopSafeStorageFile): void {
    const filePath = this.storagePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
    chmodBestEffort(filePath);
  }

  private storagePath(): string {
    return resolveCanonicalPluginDesktopSecretStoragePath(this.mindRoot);
  }
}

export class ObsidianSecretStorage {
  private readonly backend: ObsidianSecretStorageBackend;

  constructor(
    mindRoot: string,
    private readonly getActivePluginId: () => string | undefined,
    private readonly warn?: SecretStorageWarningSink,
    backend?: ObsidianSecretStorageBackend,
  ) {
    this.backend = backend ?? createDefaultObsidianSecretStorageBackend(mindRoot);
  }

  async setSecret(id: string, secret: string): Promise<void> {
    const pluginId = this.requirePluginContext();
    const normalizedId = normalizeSecretId(id);
    if (typeof secret !== 'string') {
      throw new Error('[obsidian-compat] SecretStorage.setSecret requires a string secret.');
    }

    await this.runBackendOperation('set', pluginId, normalizedId, () => this.backend.setSecret(pluginId, normalizedId, secret));
  }

  async getSecret(id: string): Promise<string | null> {
    const pluginId = this.requirePluginContext();
    const normalizedId = normalizeSecretId(id);
    return this.runBackendOperation('get', pluginId, normalizedId, () => this.backend.getSecret(pluginId, normalizedId));
  }

  async listSecrets(): Promise<string[]> {
    const pluginId = this.requirePluginContext();
    const secrets = await this.runBackendOperation('list', pluginId, undefined, () => this.backend.listSecrets(pluginId));
    return [...secrets].sort();
  }

  async removePluginSecrets(pluginId: string): Promise<number> {
    assertSafeObsidianPluginId(pluginId);
    return this.runBackendOperation('remove', pluginId, undefined, () => this.backend.removePluginSecrets(pluginId));
  }

  getSummary(pluginId: string): ObsidianSecretStorageSummary {
    assertSafeObsidianPluginId(pluginId);
    return this.backend.getSummary(pluginId);
  }

  private requirePluginContext(): string {
    const pluginId = this.getActivePluginId();
    if (!pluginId) {
      throw new Error('[obsidian-compat] SecretStorage requires an active plugin context.');
    }
    assertSafeObsidianPluginId(pluginId);
    return pluginId;
  }

  private async runBackendOperation<T>(
    operation: 'set' | 'get' | 'list' | 'remove',
    pluginId: string,
    secretId: string | undefined,
    run: () => MaybePromise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const code = error instanceof SecretStorageBackendError
        ? error.code
        : `secret-storage-${operation}-failed`;
      const target = secretId ? `"${secretId}"` : `plugin "${pluginId}"`;
      this.warn?.({
        pluginId,
        code,
        message: `SecretStorage ${operation} failed for ${target} using backend "${this.backend.backend}".`,
      });
      if (error instanceof SecretStorageBackendError) {
        throw new Error(error.message);
      }
      throw new Error(`[obsidian-compat] SecretStorage backend "${this.backend.backend}" failed during ${operation}.`);
    }
  }
}

export function createDefaultObsidianSecretStorageBackend(
  mindRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ObsidianSecretStorageBackend {
  const desktopBroker = getDesktopSecretStorageBrokerConfigFromEnv(env);
  if (desktopBroker) {
    return new DesktopSafeStorageBrokerBackend(mindRoot, desktopBroker);
  }
  return new LocalAesGcmSecretStorageBackend(mindRoot);
}

export function getDesktopSecretStorageBrokerConfigFromEnv(
  env: Record<string, string | undefined>,
): DesktopSecretStorageBrokerConfig | null {
  const url = env[DESKTOP_SECRET_BROKER_URL_ENV]?.trim();
  const token = env[DESKTOP_SECRET_BROKER_TOKEN_ENV]?.trim();
  if (!url || !token) return null;
  try {
    normalizeDesktopSecretBrokerUrl(url);
  } catch {
    return null;
  }
  return { url, token };
}

function normalizeDesktopSecretBrokerUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:') {
    throw new Error('[obsidian-compat] Desktop SecretStorage broker must use http loopback.');
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error('[obsidian-compat] Desktop SecretStorage broker must be loopback-only.');
  }
  return url;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function normalizeSecretId(id: string): string {
  const normalized = id.trim();
  if (!SECRET_ID_PATTERN.test(normalized)) {
    throw new Error(`[obsidian-compat] SecretStorage id must contain only lowercase letters, numbers, and dashes: ${id}`);
  }
  return normalized;
}

export function removeObsidianPluginSecrets(mindRoot: string, pluginId: string): number {
  assertSafeObsidianPluginId(pluginId);
  return new LocalAesGcmSecretStorageBackend(mindRoot).removePluginSecrets(pluginId);
}

function emptyStore(): SecretStorageFile {
  return {
    version: SECRET_STORAGE_VERSION,
    backend: SECRET_STORAGE_BACKEND,
    entries: {},
  };
}

function emptyDesktopSafeStorageStore(): DesktopSafeStorageFile {
  return {
    version: SECRET_STORAGE_VERSION,
    backend: DESKTOP_SAFE_STORAGE_BACKEND,
    entries: {},
  };
}

function normalizeEntries(value: unknown): Record<string, Record<string, StoredSecretEntry>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: Record<string, Record<string, StoredSecretEntry>> = {};
  for (const [pluginId, pluginValue] of Object.entries(value)) {
    if (!pluginValue || typeof pluginValue !== 'object' || Array.isArray(pluginValue)) continue;
    try {
      assertSafeObsidianPluginId(pluginId);
    } catch {
      continue;
    }
    const pluginEntries: Record<string, StoredSecretEntry> = {};
    for (const [secretId, entry] of Object.entries(pluginValue)) {
      if (!isStoredSecretEntry(entry)) continue;
      try {
        pluginEntries[normalizeSecretId(secretId)] = entry;
      } catch {
        continue;
      }
    }
    if (Object.keys(pluginEntries).length > 0) {
      entries[pluginId] = pluginEntries;
    }
  }
  return entries;
}

function isStoredSecretEntry(value: unknown): value is StoredSecretEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<StoredSecretEntry>;
  return entry.alg === 'aes-256-gcm'
    && typeof entry.iv === 'string'
    && typeof entry.tag === 'string'
    && typeof entry.data === 'string'
    && typeof entry.updatedAt === 'string';
}

function normalizeDesktopSafeStorageEntries(value: unknown): Record<string, Record<string, DesktopSafeStorageEntry>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: Record<string, Record<string, DesktopSafeStorageEntry>> = {};
  for (const [pluginId, pluginValue] of Object.entries(value)) {
    if (!pluginValue || typeof pluginValue !== 'object' || Array.isArray(pluginValue)) continue;
    try {
      assertSafeObsidianPluginId(pluginId);
    } catch {
      continue;
    }
    const pluginEntries: Record<string, DesktopSafeStorageEntry> = {};
    for (const [secretId, entry] of Object.entries(pluginValue)) {
      if (!isDesktopSafeStorageEntry(entry)) continue;
      try {
        pluginEntries[normalizeSecretId(secretId)] = entry;
      } catch {
        continue;
      }
    }
    if (Object.keys(pluginEntries).length > 0) {
      entries[pluginId] = pluginEntries;
    }
  }
  return entries;
}

function isDesktopSafeStorageEntry(value: unknown): value is DesktopSafeStorageEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<DesktopSafeStorageEntry>;
  return entry.alg === 'electron-safe-storage'
    && typeof entry.data === 'string'
    && typeof entry.updatedAt === 'string';
}

function relativeToMindRoot(mindRoot: string, filePath: string): string {
  return path.relative(mindRoot, filePath).replace(/\\/g, '/');
}

function chmodBestEffort(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod is best effort on platforms/filesystems that do not preserve POSIX modes.
  }
}
