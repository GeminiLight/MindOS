export const dynamic = 'force-dynamic';

import { complete } from '@mariozechner/pi-ai';
import {
  handleSettingsTestKeyPost,
  type SettingsTestKeyModelInput,
  type SettingsTestKeyServices,
} from '@geminilight/mindos/server';
import { effectiveAiConfig, readBaseUrlCompat, readSettings, writeSettings } from '@/lib/settings';
import { getModelConfig, normalizeBaseUrl } from '@/lib/agent/model';
import { isProviderId, type ProviderId } from '@/lib/agent/providers';
import { findProvider, isProviderEntryId } from '@/lib/custom-endpoints';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

function clearCompatCacheForBaseUrl(baseUrl?: string) {
  try {
    const normalized = normalizeBaseUrl(baseUrl ?? '');
    if (!normalized) return;

    const compat = readBaseUrlCompat();
    if (!compat[normalized]) return;

    const settings = readSettings();
    const updated = { ...(settings.baseUrlCompat ?? {}) };
    delete updated[normalized];
    writeSettings({ ...settings, baseUrlCompat: updated });
  } catch {
    // Cache cleanup must never turn a successful connectivity test into a failure.
  }
}

async function testModel({ provider, apiKey, model, baseUrl, signal }: SettingsTestKeyModelInput) {
  const { model: piModel } = getModelConfig({
    provider: provider as ProviderId,
    apiKey,
    model,
    baseUrl: baseUrl || undefined,
  });
  await complete(piModel, {
    messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
  }, {
    apiKey,
    signal,
  });
}

const services: SettingsTestKeyServices = {
  isProviderId,
  isProviderEntryId,
  readSettings,
  findProvider: findProvider as SettingsTestKeyServices['findProvider'],
  effectiveAiConfig,
  testModel,
  clearCompatCacheForBaseUrl,
};

export async function POST(req: Request) {
  try {
    return toNextResponse(await handleSettingsTestKeyPost(await req.json(), services));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
