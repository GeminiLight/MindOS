export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { getModelConfig } from '@/lib/agent/model';
import { getPiSupportedThinkingLevels } from '@/lib/agent/pi-models';
import {
  clampMindosThinkingLevel,
  isMindosThinkingLevel,
  type MindosThinkingLevel,
} from '@/lib/agent/thinking';
import { isProviderId, type ProviderId } from '@/lib/agent/providers';
import {
  findProvider,
  isProviderEntryId,
  type Provider,
} from '@/lib/custom-endpoints';
import { effectiveAiConfig, readSettings } from '@/lib/settings';

type ModelThinkingRequest = {
  provider?: unknown;
  model?: unknown;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  let body: ModelThinkingRequest;
  try {
    body = await request.json() as ModelThinkingRequest;
  } catch {
    return jsonError('Invalid JSON body');
  }

  const settings = readSettings();
  const providerSelection = typeof body.provider === 'string' && body.provider.trim()
    ? body.provider.trim()
    : settings.ai?.activeProvider;
  if (!providerSelection) return jsonError('Provider not found');

  const requestedModel = typeof body.model === 'string' && body.model.trim()
    ? body.model.trim()
    : undefined;
  let providerEntry: Provider | undefined;
  let provider: ProviderId;
  let apiKey: string | undefined;
  let model: string | undefined;
  let baseUrl: string | undefined;

  if (isProviderEntryId(providerSelection)) {
    providerEntry = findProvider((settings.ai?.providers ?? []) as Provider[], providerSelection);
    if (!providerEntry) return jsonError('Provider not found');
    provider = providerEntry.protocol;
    apiKey = providerEntry.apiKey;
    model = requestedModel ?? providerEntry.model;
    baseUrl = providerEntry.baseUrl;
  } else if (isProviderId(providerSelection)) {
    const configured = effectiveAiConfig(providerSelection);
    provider = providerSelection;
    apiKey = configured.apiKey;
    model = requestedModel ?? configured.model;
    baseUrl = configured.baseUrl;
    providerEntry = configured.providerEntry;
  } else {
    return jsonError('Provider not found');
  }

  try {
    const resolved = await getModelConfig({
      provider,
      apiKey,
      model,
      baseUrl,
      providerEntry,
    });
    const levels = await getPiSupportedThinkingLevels(resolved.model as never) as MindosThinkingLevel[];
    const legacyDefault: MindosThinkingLevel = settings.agent?.enableThinking ? 'medium' : 'off';
    const requestedDefault = isMindosThinkingLevel(settings.agent?.thinkingLevel)
      ? settings.agent.thinkingLevel
      : legacyDefault;
    const defaultLevel = clampMindosThinkingLevel(requestedDefault, levels);

    return NextResponse.json({
      ok: true,
      provider: providerSelection,
      model: resolved.modelName,
      reasoning: levels.some((level) => level !== 'off'),
      defaultLevel,
      levels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message || 'Unable to resolve model thinking support', 500);
  }
}
