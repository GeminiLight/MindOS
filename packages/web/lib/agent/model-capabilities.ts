import type { ProviderId } from './providers';
import type { Provider, ProviderModelCapability, ProviderModelCapabilitySource } from '../custom-endpoints';

export const UNKNOWN_MODEL_CONTEXT_FALLBACK = 128_000;
export const UNKNOWN_MODEL_MAX_TOKENS_FALLBACK = 16_384;

export type ResolvedModelCapabilities = {
  providerEntryId?: string;
  protocol: ProviderId;
  baseUrl: string;
  modelId: string;
  contextWindow?: number;
  contextTokens?: number;
  effectiveContextWindow: number;
  maxTokens?: number;
  input?: Array<'text' | 'image' | 'audio' | 'video'>;
  reasoning?: boolean;
  source: ProviderModelCapabilitySource;
  isFallback: boolean;
  warnings: string[];
};

export type ResolveModelCapabilitiesInput = {
  providerEntry?: Provider;
  protocol: ProviderId;
  baseUrl: string;
  modelId: string;
  registryModel?: {
    contextWindow?: unknown;
    maxTokens?: unknown;
    input?: unknown;
    reasoning?: unknown;
  };
};

type CandidateCapabilities = Omit<ProviderModelCapability, 'id'> & {
  id?: string;
  source: ProviderModelCapabilitySource;
};

export function resolveModelCapabilities(input: ResolveModelCapabilitiesInput): ResolvedModelCapabilities {
  const warnings: string[] = [];
  const providerModel = findProviderModelCapability(input.providerEntry, input.modelId);
  const providerDefaults = providerEntryDefaults(input.providerEntry);
  const catalog = lookupCatalogCapabilities(input);
  const registry = registryCapabilities(input.registryModel);
  const candidates = [providerModel, providerDefaults, catalog, registry].filter(Boolean) as CandidateCapabilities[];

  const contextTokensCandidate = candidates.find((candidate) => positiveInteger(candidate.contextTokens) !== undefined);
  const contextWindowCandidate = candidates.find((candidate) => positiveInteger(candidate.contextWindow) !== undefined);
  const maxTokensCandidate = candidates.find((candidate) => positiveInteger(candidate.maxTokens) !== undefined);
  const inputCandidate = candidates.find((candidate) => candidate.input && candidate.input.length > 0);
  const reasoningCandidate = candidates.find((candidate) => typeof candidate.reasoning === 'boolean');

  const contextTokens = positiveInteger(contextTokensCandidate?.contextTokens);
  const contextWindow = positiveInteger(contextWindowCandidate?.contextWindow);
  const effectiveContextWindow = positiveMin(contextTokens, contextWindow)
    ?? contextTokens
    ?? contextWindow
    ?? UNKNOWN_MODEL_CONTEXT_FALLBACK;
  const source = contextTokensCandidate?.source
    ?? contextWindowCandidate?.source
    ?? 'fallback';
  const isFallback = source === 'fallback';

  if (contextTokens !== undefined && contextWindow !== undefined && contextTokens > contextWindow) {
    warnings.push(`contextTokens ${contextTokens} exceeds contextWindow ${contextWindow}; using ${effectiveContextWindow}`);
  }
  if (isFallback) {
    warnings.push(`Unknown model context window for ${input.modelId}; using ${UNKNOWN_MODEL_CONTEXT_FALLBACK} token fallback budget`);
  }

  return {
    ...(input.providerEntry?.id ? { providerEntryId: input.providerEntry.id } : {}),
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    effectiveContextWindow,
    maxTokens: positiveInteger(maxTokensCandidate?.maxTokens) ?? UNKNOWN_MODEL_MAX_TOKENS_FALLBACK,
    ...(inputCandidate?.input ? { input: inputCandidate.input } : {}),
    ...(typeof reasoningCandidate?.reasoning === 'boolean' ? { reasoning: reasoningCandidate.reasoning } : {}),
    source,
    isFallback,
    warnings,
  };
}

function findProviderModelCapability(providerEntry: Provider | undefined, modelId: string): CandidateCapabilities | undefined {
  const model = providerEntry?.models?.find((entry) => entry.id === modelId);
  if (!model) return undefined;
  return { ...model, source: model.source ?? 'user' };
}

function providerEntryDefaults(providerEntry: Provider | undefined): CandidateCapabilities | undefined {
  if (!providerEntry) return undefined;
  const hasCaps = positiveInteger(providerEntry.contextWindow) !== undefined
    || positiveInteger(providerEntry.contextTokens) !== undefined
    || positiveInteger(providerEntry.maxTokens) !== undefined;
  if (!hasCaps) return undefined;
  return {
    contextWindow: providerEntry.contextWindow,
    contextTokens: providerEntry.contextTokens,
    maxTokens: providerEntry.maxTokens,
    source: 'user',
  };
}

function registryCapabilities(registryModel: ResolveModelCapabilitiesInput['registryModel']): CandidateCapabilities | undefined {
  if (!registryModel) return undefined;
  const contextWindow = positiveInteger(registryModel.contextWindow);
  const maxTokens = positiveInteger(registryModel.maxTokens);
  const input = normalizeInput(registryModel.input);
  const reasoning = typeof registryModel.reasoning === 'boolean' ? registryModel.reasoning : undefined;
  if (contextWindow === undefined && maxTokens === undefined && !input && reasoning === undefined) return undefined;
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(input ? { input } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    source: 'pi-ai',
  };
}

function lookupCatalogCapabilities(input: ResolveModelCapabilitiesInput): CandidateCapabilities | undefined {
  const endpoint = endpointIdentity(input.baseUrl);
  const modelId = input.modelId;

  if (endpoint?.provider === 'stepfun') {
    if (modelId === 'step-3.7-flash') {
      return {
        contextWindow: 256_000,
        maxTokens: 256_000,
        input: ['text'],
        reasoning: true,
        source: 'catalog',
      };
    }
    if (modelId === 'step-3.5-flash' || modelId === 'step-3.5-flash-2603') {
      return {
        contextWindow: 262_144,
        maxTokens: 65_536,
        input: ['text'],
        reasoning: true,
        source: 'catalog',
      };
    }
  }

  return undefined;
}

function endpointIdentity(baseUrl: string): { provider: 'stepfun' } | undefined {
  if (!baseUrl) return undefined;
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === 'api.stepfun.com' || host === 'api.stepfun.ai') {
      return { provider: 'stepfun' };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function positiveMin(...values: Array<number | undefined>): number | undefined {
  let result: number | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    result = result === undefined ? value : Math.min(result, value);
  }
  return result;
}

function normalizeInput(raw: unknown): ResolvedModelCapabilities['input'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: NonNullable<ResolvedModelCapabilities['input']> = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (
      value !== 'text'
      && value !== 'image'
      && value !== 'audio'
      && value !== 'video'
    ) {
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result.length > 0 ? result : undefined;
}
