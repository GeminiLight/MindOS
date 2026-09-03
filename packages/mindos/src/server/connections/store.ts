import crypto from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import type { ConnectionBinding, ConnectionCandidate, ConnectionRegistry } from './types.js';

const REGISTRY_PATH = '.mindos/connections/bindings.json';
const LOCK_PATH = '.mindos/connections/bindings.lock';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SECRET_KEY = /secret|token|password|authorization|cookie|(?:^|_)env(?:$|_)/i;

export function listConnectionBindings(mindRoot: string): ConnectionBinding[] {
  return readRegistry(mindRoot).bindings;
}

export function getConnectionBinding(mindRoot: string, id: string): ConnectionBinding | null {
  requireSafeId(id);
  return listConnectionBindings(mindRoot).find((binding) => binding.id === id) ?? null;
}

export function bindConnection(mindRoot: string, candidate: ConnectionCandidate, now = new Date()): ConnectionBinding {
  validateCandidate(candidate);
  const timestamp = validNow(now).toISOString();
  return withRegistryLock(mindRoot, () => {
    const registry = readRegistry(mindRoot);
    const existing = registry.bindings.find((binding) => binding.id === candidate.id);
    const binding: ConnectionBinding = {
      schemaVersion: 1,
      id: candidate.id,
      provider: candidate.provider,
      adapter: candidate.adapter,
      status: candidate.status,
      credentialRef: structuredClone(candidate.credentialRef),
      application: structuredClone(candidate.application),
      owner: structuredClone(candidate.owner),
      identities: structuredClone(candidate.identities),
      capabilities: structuredClone(candidate.capabilities),
      issues: structuredClone(candidate.issues),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastVerifiedAt: timestamp,
    };
    registry.bindings = [binding, ...registry.bindings.filter((entry) => entry.id !== binding.id)];
    writeRegistry(mindRoot, registry);
    return binding;
  });
}

export function refreshConnectionBinding(
  mindRoot: string,
  id: string,
  candidate: ConnectionCandidate,
  now = new Date(),
): ConnectionBinding {
  requireSafeId(id);
  validateCandidate(candidate);
  const existing = getConnectionBinding(mindRoot, id);
  if (!existing) throw new Error(`Connection binding not found: ${id}`);
  if (candidate.id !== id) throw new Error('Connection refresh candidate does not match the bound connection.');
  if (
    candidate.credentialRef.kind !== existing.credentialRef.kind
    || candidate.credentialRef.profile !== existing.credentialRef.profile
  ) {
    throw new Error('Connection credential ownership cannot change during refresh.');
  }
  return bindConnection(mindRoot, candidate, now);
}

export function unbindConnection(mindRoot: string, id: string): boolean {
  requireSafeId(id);
  return withRegistryLock(mindRoot, () => {
    const registry = readRegistry(mindRoot);
    const next = registry.bindings.filter((binding) => binding.id !== id);
    if (next.length === registry.bindings.length) return false;
    registry.bindings = next;
    writeRegistry(mindRoot, registry);
    return true;
  });
}

function readRegistry(mindRoot: string): ConnectionRegistry {
  const file = resolveExistingSafe(mindRoot, REGISTRY_PATH);
  if (!existsSync(file)) return { schemaVersion: 1, bindings: [] };
  try {
    const value = JSON.parse(readFileSync(file, 'utf-8')) as ConnectionRegistry;
    if (value.schemaVersion !== 1 || !Array.isArray(value.bindings)) throw new Error('invalid registry shape');
    for (const binding of value.bindings) validateBinding(binding);
    return structuredClone(value);
  } catch (error) {
    if (error instanceof Error && /secret-bearing|invalid connection/i.test(error.message)) throw error;
    throw new Error('Connection registry is corrupt; the original file was preserved.');
  }
}

function writeRegistry(mindRoot: string, registry: ConnectionRegistry): void {
  assertNoSecretBearingFields(registry);
  const file = resolveExistingSafe(mindRoot, REGISTRY_PATH);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
    if (process.platform !== 'win32') chmodSync(file, 0o600);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function withRegistryLock<T>(mindRoot: string, operation: () => T): T {
  const lock = resolveExistingSafe(mindRoot, LOCK_PATH);
  mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  let descriptor: number;
  try {
    descriptor = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Connection registry is busy; retry the operation.');
    }
    throw error;
  }
  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try { unlinkSync(lock); } catch { /* best-effort cleanup */ }
  }
}

function validateCandidate(candidate: ConnectionCandidate): void {
  if (!candidate || candidate.schemaVersion !== 1 || !SAFE_ID.test(candidate.id)) {
    throw new Error('Invalid connection candidate.');
  }
  if (candidate.provider !== 'feishu' || candidate.adapter !== 'lark-cli') {
    throw new Error('Invalid connection provider or adapter.');
  }
  if (
    candidate.credentialRef?.kind !== 'lark-cli-profile'
    || !path.isAbsolute(candidate.credentialRef.executablePath)
    || !candidate.credentialRef.profile
  ) {
    throw new Error('Invalid external credential reference.');
  }
  if (candidate.owner?.identity !== 'bot' || candidate.owner.source !== 'lark-cli-profile') {
    throw new Error('Invalid connection owner.');
  }
  assertNoSecretBearingFields(candidate);
}

function validateBinding(binding: ConnectionBinding): void {
  validateCandidate({ ...binding, discoveredAt: binding.lastVerifiedAt });
  if (!binding.createdAt || !binding.updatedAt || !binding.lastVerifiedAt) {
    throw new Error('Invalid connection binding timestamps.');
  }
}

function assertNoSecretBearingFields(value: unknown, field = ''): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretBearingFields(item, field);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) throw new Error(`Connection data contains a secret-bearing field: ${key}`);
    assertNoSecretBearingFields(nested, key);
  }
}

function requireSafeId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error('Connection id is invalid.');
}

function validNow(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new Error('Connection timestamp must be valid.');
  return now;
}
