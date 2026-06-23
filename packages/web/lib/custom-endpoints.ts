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
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  models?: ProviderModelCapability[];
}

export type ProviderModelCapabilitySource =
  | 'user'
  | 'catalog'
  | 'discovered'
  | 'pi-ai'
  | 'fallback';

export interface ProviderModelCapability {
  id: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  input?: Array<'text' | 'image' | 'audio' | 'video'>;
  reasoning?: boolean;
  source?: ProviderModelCapabilitySource;
  updatedAt?: string;
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

function normalizeProvider(e: unknown): Provider | null {
  if (!e || typeof e !== 'object') return null;
  const obj = e as Record<string, unknown>;
  const validShape = (
    typeof obj.id === 'string' && obj.id.startsWith(P_PREFIX) &&
    typeof obj.protocol === 'string' && isProviderId(obj.protocol) &&
    typeof obj.apiKey === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.baseUrl === 'string'
  );
  if (!validShape) return null;

  const protocol = obj.protocol as ProviderId;
  const name = typeof obj.name === 'string' && obj.name.trim().length > 0
    ? obj.name
    : PROVIDER_PRESETS[protocol].name;

  const caps = normalizeProviderCapabilityFields(obj);

  return {
    id: obj.id as string,
    name,
    protocol,
    apiKey: obj.apiKey as string,
    model: obj.model as string,
    baseUrl: obj.baseUrl as string,
    ...caps,
  };
}

const CAPABILITY_SOURCES = new Set<ProviderModelCapabilitySource>([
  'user',
  'catalog',
  'discovered',
  'pi-ai',
  'fallback',
]);

const INPUT_MODALITIES = new Set(['text', 'image', 'audio', 'video']);

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeInputModalities(raw: unknown): ProviderModelCapability['input'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: NonNullable<ProviderModelCapability['input']> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !INPUT_MODALITIES.has(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item as NonNullable<ProviderModelCapability['input']>[number]);
  }
  return result.length > 0 ? result : undefined;
}

function normalizeCapabilitySource(raw: unknown): ProviderModelCapabilitySource | undefined {
  return typeof raw === 'string' && CAPABILITY_SOURCES.has(raw as ProviderModelCapabilitySource)
    ? raw as ProviderModelCapabilitySource
    : undefined;
}

function normalizeProviderModelCapability(raw: unknown): ProviderModelCapability | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!id) return null;

  const capability: ProviderModelCapability = { id };
  const contextWindow = positiveInteger(source.contextWindow);
  const contextTokens = positiveInteger(source.contextTokens);
  const maxTokens = positiveInteger(source.maxTokens);
  const input = normalizeInputModalities(source.input);
  const capabilitySource = normalizeCapabilitySource(source.source);

  if (contextWindow !== undefined) capability.contextWindow = contextWindow;
  if (contextTokens !== undefined) capability.contextTokens = contextTokens;
  if (maxTokens !== undefined) capability.maxTokens = maxTokens;
  if (input) capability.input = input;
  if (typeof source.reasoning === 'boolean') capability.reasoning = source.reasoning;
  if (capabilitySource) capability.source = capabilitySource;
  if (typeof source.updatedAt === 'string' && source.updatedAt.trim()) {
    capability.updatedAt = source.updatedAt.trim();
  }

  return hasMeaningfulModelCapability(capability) ? capability : null;
}

function hasMeaningfulModelCapability(capability: ProviderModelCapability): boolean {
  return capability.contextWindow !== undefined
    || capability.contextTokens !== undefined
    || capability.maxTokens !== undefined
    || (capability.input !== undefined && capability.input.length > 0)
    || typeof capability.reasoning === 'boolean';
}

function normalizeProviderCapabilityFields(source: Record<string, unknown>): Pick<Provider, 'contextWindow' | 'contextTokens' | 'maxTokens' | 'models'> {
  const result: Pick<Provider, 'contextWindow' | 'contextTokens' | 'maxTokens' | 'models'> = {};
  const contextWindow = positiveInteger(source.contextWindow);
  const contextTokens = positiveInteger(source.contextTokens);
  const maxTokens = positiveInteger(source.maxTokens);
  const models = Array.isArray(source.models)
    ? source.models
      .map(normalizeProviderModelCapability)
      .filter((model): model is ProviderModelCapability => model !== null)
    : [];

  if (contextWindow !== undefined) result.contextWindow = contextWindow;
  if (contextTokens !== undefined) result.contextTokens = contextTokens;
  if (maxTokens !== undefined) result.maxTokens = maxTokens;
  if (models.length > 0) result.models = models;

  return result;
}

/** Parse an array of providers from unknown config data, filtering invalid entries */
export function parseProviders(raw: unknown): Provider[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeProvider)
    .filter((provider): provider is Provider => provider !== null);
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
  const oldActive = (typeof ai.activeProvider === 'string' ? ai.activeProvider : ai.provider ?? 'openai') as string;
  const oldCustom = (parsed.customProviders ?? []) as OldCustomProvider[];

  const newProviders: Provider[] = [];
  let activeId = '';

  // 1. Migrate built-in providers (only those with actual content)
  for (const [protocolId, cfg] of Object.entries(oldProviders)) {
    if (!cfg || !isProviderId(protocolId)) continue;
    // Skip empty entries (no key, no model, no baseUrl)
    if (!cfg.apiKey && !cfg.model && !cfg.baseUrl && protocolId !== oldActive) continue;

    const preset = PROVIDER_PRESETS[protocolId];
    const id = generateProviderId();
    newProviders.push({
      id,
      name: preset?.name ?? protocolId,
      protocol: protocolId as ProviderId,
      apiKey: cfg.apiKey ?? '',
      model: cfg.model ?? preset?.defaultModel ?? '',
      baseUrl: cfg.baseUrl ?? preset?.fixedBaseUrl ?? '',
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
