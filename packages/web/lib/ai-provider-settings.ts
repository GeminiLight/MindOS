import { getDefaultBaseUrl, isProviderId, PROVIDER_PRESETS, type ProviderId } from '@/lib/agent/providers';
import { generateProviderId, isProviderEntryId, type Provider } from '@/lib/custom-endpoints';

export interface AiProviderSelectionState {
  activeProvider: string;
  providers: Provider[];
}

export function buildDefaultProviderName(
  protocol: ProviderId,
  existingNames: string[] = [],
  excludeName?: string,
  locale?: string,
): string {
  const preset = PROVIDER_PRESETS[protocol];
  const baseName = locale === 'zh' ? preset.nameZh : preset.name;
  const normalizedExclude = excludeName?.trim().toLowerCase();
  const normalizedExisting = new Set(
    existingNames
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => name.toLowerCase() !== normalizedExclude)
      .map((name) => name.toLowerCase()),
  );

  if (!normalizedExisting.has(baseName.trim().toLowerCase())) return baseName;

  let index = 2;
  while (normalizedExisting.has(`${baseName} ${index}`.toLowerCase())) {
    index++;
  }
  return `${baseName} ${index}`;
}

export function getProviderDefaultBaseUrl(protocol: ProviderId): string {
  return PROVIDER_PRESETS[protocol].fixedBaseUrl ?? getDefaultBaseUrl(protocol) ?? '';
}

export function isProviderDefaultName(name: string | undefined, protocol: ProviderId | undefined): boolean {
  if (!name || !protocol) return false;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  const preset = PROVIDER_PRESETS[protocol];
  return normalized === preset.name.toLowerCase()
    || normalized === preset.nameZh.toLowerCase()
    || /^.+ \d+$/.test(normalized) && (
      normalized.startsWith(`${preset.name.toLowerCase()} `)
      || normalized.startsWith(`${preset.nameZh.toLowerCase()} `)
    );
}

export function createProviderFromProtocol(
  protocol: ProviderId,
  existingNames: string[] = [],
  locale?: string,
  idFactory: () => string = generateProviderId,
): Provider {
  return {
    id: idFactory(),
    name: buildDefaultProviderName(protocol, existingNames, undefined, locale),
    protocol,
    apiKey: '',
    model: PROVIDER_PRESETS[protocol].defaultModel,
    baseUrl: getProviderDefaultBaseUrl(protocol),
  };
}

export function rebaseProviderProtocol(
  provider: Provider,
  protocol: ProviderId,
  siblingNames: string[] = [],
  locale?: string,
): Provider {
  const shouldUseDefaultName = isProviderDefaultName(provider.name, provider.protocol);
  return {
    ...provider,
    name: shouldUseDefaultName
      ? buildDefaultProviderName(protocol, siblingNames, provider.name, locale)
      : provider.name,
    protocol,
    apiKey: '',
    model: PROVIDER_PRESETS[protocol].defaultModel,
    baseUrl: getProviderDefaultBaseUrl(protocol),
  };
}

export function resolveAiProviderSelection(
  ai: AiProviderSelectionState,
  selectedId: string,
  locale?: string,
  idFactory: () => string = generateProviderId,
): AiProviderSelectionState {
  if (isProviderEntryId(selectedId)) {
    return ai.providers.some((provider) => provider.id === selectedId)
      ? { ...ai, activeProvider: selectedId }
      : ai;
  }

  if (!isProviderId(selectedId)) return ai;

  const existing = ai.providers.find((provider) => provider.protocol === selectedId);
  if (existing) {
    return { ...ai, activeProvider: existing.id };
  }

  const provider = createProviderFromProtocol(
    selectedId,
    ai.providers.map((item) => item.name),
    locale,
    idFactory,
  );
  return {
    activeProvider: provider.id,
    providers: [...ai.providers, provider],
  };
}
