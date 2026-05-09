export const dynamic = 'force-dynamic';

import { getModels as piGetModels } from '@mariozechner/pi-ai';
import {
  handleSettingsListModelsPost,
  type SettingsListModelsServices,
} from '@geminilight/mindos/server';
import { effectiveAiConfig, readSettings } from '@/lib/settings';
import {
  buildCompatEndpointCandidates,
  getDefaultBaseUrl,
  getProviderApiType,
  isProviderId,
  PROVIDER_PRESETS,
  type ProviderId,
  toPiProvider,
} from '@/lib/agent/providers';
import { findProvider, isProviderEntryId } from '@/lib/custom-endpoints';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

function getRegistryModels(provider: string): string[] {
  try {
    const models = piGetModels(toPiProvider(provider as ProviderId) as any);
    return models.map((model: any) => model.id as string).filter(Boolean).sort();
  } catch {
    return [];
  }
}

const services: SettingsListModelsServices = {
  isProviderId,
  isProviderEntryId,
  readSettings,
  findProvider: findProvider as SettingsListModelsServices['findProvider'],
  effectiveAiConfig,
  supportsListModels: (provider) => PROVIDER_PRESETS[provider as ProviderId]?.supportsListModels !== false,
  getRegistryModels,
  getProviderApiType,
  getDefaultBaseUrl,
  buildEndpointCandidates: buildCompatEndpointCandidates,
  fetch: async (input, init) => fetch(input, init),
};

export async function POST(req: Request) {
  try {
    return toNextResponse(await handleSettingsListModelsPost(await req.json(), services));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
