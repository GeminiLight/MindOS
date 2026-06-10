import type { AgentRuntimeDescriptor } from '@geminilight/mindos/server';

type NativeRuntimeKind = Extract<AgentRuntimeDescriptor['kind'], 'codex' | 'claude'>;

const NATIVE_RUNTIME_DESCRIPTOR_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  descriptor: AgentRuntimeDescriptor;
  cachedAt: number;
};

const descriptorCache = new Map<string, CacheEntry>();

function cacheKey(kind: NativeRuntimeKind, id: string): string {
  return `${kind}:${id}`;
}

function isNativeRuntimeDescriptor(value: unknown): value is AgentRuntimeDescriptor & { kind: NativeRuntimeKind } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AgentRuntimeDescriptor>;
  return (record.kind === 'codex' || record.kind === 'claude') && typeof record.id === 'string';
}

export function rememberAvailableNativeRuntimeDescriptor(
  descriptor: AgentRuntimeDescriptor,
  now = Date.now(),
): void {
  if (!isNativeRuntimeDescriptor(descriptor) || descriptor.status !== 'available') return;
  descriptorCache.set(cacheKey(descriptor.kind, descriptor.id), {
    descriptor,
    cachedAt: now,
  });
}

export function rememberAvailableNativeRuntimeDescriptorsFromPayload(
  payload: unknown,
  now = Date.now(),
): void {
  if (!payload || typeof payload !== 'object') return;
  const record = payload as { runtime?: unknown; runtimes?: unknown };
  if (isNativeRuntimeDescriptor(record.runtime)) {
    rememberAvailableNativeRuntimeDescriptor(record.runtime, now);
  }
  if (Array.isArray(record.runtimes)) {
    for (const runtime of record.runtimes) {
      if (isNativeRuntimeDescriptor(runtime)) {
        rememberAvailableNativeRuntimeDescriptor(runtime, now);
      }
    }
  }
}

export function getCachedAvailableNativeRuntimeDescriptor(
  kind: NativeRuntimeKind,
  id: string,
  now = Date.now(),
): AgentRuntimeDescriptor | null {
  const key = cacheKey(kind, id);
  const entry = descriptorCache.get(key);
  if (!entry) return null;
  if (now - entry.cachedAt > NATIVE_RUNTIME_DESCRIPTOR_CACHE_TTL_MS) {
    descriptorCache.delete(key);
    return null;
  }
  return {
    ...entry.descriptor,
    availability: {
      ...(entry.descriptor.availability ?? {
        checkedAt: new Date(entry.cachedAt).toISOString(),
        sources: ['native-health'],
      }),
      stale: true,
      diagnosticHints: [
        ...(entry.descriptor.availability?.diagnosticHints ?? []),
        'Using the most recent verified local runtime path while MindOS refreshes runtime status.',
      ],
    },
  };
}

export function resetNativeRuntimeDescriptorCacheForTest(): void {
  descriptorCache.clear();
}
