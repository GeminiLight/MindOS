import { type ProviderId, isProviderId, PROVIDER_PRESETS } from './agent/providers';

// ─── Unified Provider ───────────────────────────────────────────

/**
 * A provider configuration. All providers are equal — each has a
 * user-visible name, a protocol (openai/anthropic/google/…), and
 * connection details (apiKey, model, baseUrl).
 */
export interface Provider {
  id: string;              // "p_" + 8 random alphanumeric chars
  name: string;            // User-visible display name
  protocol: ProviderId;    // Which API protocol to use
  apiKey: string;
  model: string;
  baseUrl: string;
}

const P_PREFIX = 'p_';

/** Generate a unique provider ID */
export function generateProviderId(): string {
  return P_PREFIX + Math.random().toString(36).slice(2, 10);
}

/** Check if a string is a provider ID (p_*) */
export function isProviderEntryId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(P_PREFIX);
}

/** Validate that an unknown value is a valid Provider */
export function isValidProvider(e: unknown): e is Provider {
  if (!e || typeof e !== 'object') return false;
  const obj = e as Record<string, unknown>;
  return (
    typeof obj.id === 'string' && obj.id.startsWith(P_PREFIX) &&
    typeof obj.name === 'string' && obj.name.trim().length > 0 &&
    typeof obj.protocol === 'string' && isProviderId(obj.protocol) &&
    typeof obj.apiKey === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.baseUrl === 'string'
  );
}

/** Parse an array of providers from unknown config data, filtering invalid entries */
export function parseProviders(raw: unknown): Provider[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidProvider);
}

/** Find a provider by ID from a list */
export function findProvider(providers: Provider[], id: string): Provider | undefined {
  return providers.find(p => p.id === id);
}

// ─── Migration from old format ──────────────────────────────────

interface OldProviderConfig { apiKey?: string; model?: string; baseUrl?: string }
interface OldCustomProvider {
  id: string; name: string; baseProviderId: string;
  apiKey: string; model: string; baseUrl: string;
}

/**
 * Detect whether config.json uses the old format (ai.providers is a dict)
 * and migrate to the new format (ai.providers is an array).
 *
 * Returns null if already in new format (no migration needed).
 */
export function migrateProviders(parsed: Record<string, unknown>): {
  activeProvider: string;
  providers: Provider[];
} | null {
  const ai = parsed.ai as Record<string, unknown> | undefined;
  if (!ai) return null;

  // Already new format: providers is an array
  if (Array.isArray(ai.providers)) return null;

  // Old format: providers is a dict (or missing)
  const oldProviders = (ai.providers ?? {}) as Record<string, OldProviderConfig>;
  const oldActive = (ai.provider ?? 'openai') as string;
  const oldCustom = (parsed.customProviders ?? []) as OldCustomProvider[];

  const newProviders: Provider[] = [];
  let activeId = '';

  // 1. Migrate built-in providers (only those with actual content)
  for (const [protocolId, cfg] of Object.entries(oldProviders)) {
    if (!cfg || !isProviderId(protocolId)) continue;
    // Skip empty entries (no key, no model, no baseUrl)
    if (!cfg.apiKey && !cfg.model && !cfg.baseUrl) continue;

    const preset = PROVIDER_PRESETS[protocolId];
    const id = generateProviderId();
    newProviders.push({
      id,
      name: preset?.name ?? protocolId,
      protocol: protocolId as ProviderId,
      apiKey: cfg.apiKey ?? '',
      model: cfg.model ?? '',
      baseUrl: cfg.baseUrl ?? '',
    });

    if (protocolId === oldActive) activeId = id;
  }

  // 2. Migrate custom providers
  for (const cp of oldCustom) {
    if (!cp.name || !cp.baseProviderId) continue;
    const id = generateProviderId();
    newProviders.push({
      id,
      name: cp.name,
      protocol: (isProviderId(cp.baseProviderId) ? cp.baseProviderId : 'openai') as ProviderId,
      apiKey: cp.apiKey ?? '',
      model: cp.model ?? '',
      baseUrl: cp.baseUrl ?? '',
    });

    // If old active was a custom provider ID, map it
    if (cp.id === oldActive) activeId = id;
  }

  // 3. If no active provider was mapped, pick the first one or create a default
  if (!activeId) {
    if (newProviders.length > 0) {
      activeId = newProviders[0].id;
    } else {
      // No providers at all — create default OpenAI entry
      const id = generateProviderId();
      newProviders.push({
        id,
        name: 'OpenAI',
        protocol: 'openai',
        apiKey: '',
        model: PROVIDER_PRESETS.openai?.defaultModel ?? '',
        baseUrl: '',
      });
      activeId = id;
    }
  }

  return { activeProvider: activeId, providers: newProviders };
}

// ─── Backward compat re-exports (to minimize churn during migration) ──

/** @deprecated Use Provider instead */
export type CustomProvider = Provider;
/** @deprecated Use generateProviderId instead */
export const generateCustomProviderId = generateProviderId;
/** @deprecated Use isProviderEntryId instead */
export function isCustomProviderId(id: string): boolean {
  return isProviderEntryId(id) || (typeof id === 'string' && id.startsWith('cp_'));
}
/** @deprecated Use parseProviders instead */
export const parseCustomProviders = parseProviders;
/** @deprecated Use findProvider instead */
export const findCustomProvider = findProvider;
