import { json, type MindosServerResponse } from '../response.js';

export type SettingsTestKeyPayload = {
  provider?: unknown;
  apiKey?: unknown;
  model?: unknown;
  baseUrl?: unknown;
  baseProviderId?: unknown;
};

export type SettingsTestKeyErrorCode =
  | 'auth_error'
  | 'model_not_found'
  | 'endpoint_error'
  | 'rate_limited'
  | 'network_error'
  | 'unknown';

export type SettingsTestKeyModelInput = {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  signal: AbortSignal;
};

export type SettingsTestKeyServices = {
  timeoutMs?: number;
  now?(): number;
  isProviderId?(value: string): boolean;
  isProviderEntryId?(value: string): boolean;
  readSettings?(): { ai?: { providers?: unknown[] } };
  findProvider?(providers: unknown[], id: string): { id?: string; protocol: string; apiKey?: string; model?: string; baseUrl?: string } | undefined;
  effectiveAiConfig?(provider: string): { provider: string; apiKey?: string; model?: string; baseUrl?: string };
  testModel?(input: SettingsTestKeyModelInput): Promise<void>;
  clearCompatCacheForBaseUrl?(baseUrl?: string): void;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'groq',
  'deepseek',
  'ollama',
  'lmstudio',
  'openrouter',
  'siliconflow',
]);

export async function handleSettingsTestKeyPost(
  body: SettingsTestKeyPayload | unknown,
  services: SettingsTestKeyServices = {},
): Promise<MindosServerResponse<{ ok: true; latency: number } | { ok: false; code: SettingsTestKeyErrorCode; error: string }>> {
  try {
    const payload = body && typeof body === 'object' ? body as SettingsTestKeyPayload : {};
    const provider = stringValue(payload.provider);
    const apiKey = stringValue(payload.apiKey);
    const model = stringValue(payload.model);
    const baseUrl = stringValue(payload.baseUrl);
    const baseProviderId = stringValue(payload.baseProviderId);

    if (baseProviderId && isProviderId(baseProviderId, services)) {
      if (!apiKey) return json({ ok: false, code: 'auth_error', error: 'No API key configured' });
      if (!model) return json({ ok: false, code: 'unknown', error: 'Model is required' }, { status: 400 });
      return await runConnectivityTest({ provider: baseProviderId, apiKey, model, baseUrl, services });
    }

    if (provider && isProviderEntryId(provider, services)) {
      const settings = services.readSettings?.() ?? { ai: { providers: [] } };
      const providers = Array.isArray(settings.ai?.providers) ? settings.ai.providers : [];
      const entry = services.findProvider?.(providers, provider);
      if (!entry) {
        return json({ ok: false, code: 'unknown', error: 'Provider not found' }, { status: 400 });
      }
      const resolvedKey = apiKey || entry.apiKey || '';
      if (!resolvedKey) return json({ ok: false, code: 'auth_error', error: 'No API key configured' });
      return await runConnectivityTest({
        provider: entry.protocol,
        apiKey: resolvedKey,
        model: model || entry.model || undefined,
        baseUrl: baseUrl || entry.baseUrl || undefined,
        services,
      });
    }

    if (!provider || !isProviderId(provider, services)) {
      return json({ ok: false, code: 'unknown', error: 'Invalid provider' }, { status: 400 });
    }

    const cfg = services.effectiveAiConfig?.(provider) ?? { provider, apiKey: '', model: undefined, baseUrl: undefined };
    const resolvedKey = apiKey || cfg.apiKey || '';
    if (!resolvedKey) {
      return json({ ok: false, code: 'auth_error', error: 'No API key configured' });
    }

    return await runConnectivityTest({
      provider,
      apiKey: resolvedKey,
      model: model || cfg.model || undefined,
      baseUrl: baseUrl || undefined,
      services,
    });
  } catch (error) {
    return json({ ok: false, ...classifySettingsTestKeyError(error) });
  }
}

export function classifySettingsTestKeyError(error: unknown): { code: SettingsTestKeyErrorCode; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'network_error', error: 'Request timed out' };
  }
  if (lower.includes('401') || lower.includes('403')
    || (lower.includes('invalid') && lower.includes('key'))
    || lower.includes('authentication') || lower.includes('unauthorized')
    || (lower.includes('api key') && (lower.includes('not valid') || lower.includes('incorrect')))) {
    return { code: 'auth_error', error: 'Invalid API key' };
  }
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist'))) {
    return { code: 'model_not_found', error: `Model not found: ${message.slice(0, 200)}` };
  }
  if (lower.includes('404') || lower.includes('page not found') || lower.includes('invalid url')) {
    return { code: 'endpoint_error', error: `Endpoint or protocol mismatch: ${message.slice(0, 200)}` };
  }
  if (lower.includes('429') || lower.includes('rate') || lower.includes('quota')) {
    return { code: 'rate_limited', error: 'Rate limited — try again later' };
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound')
    || lower.includes('etimedout') || lower.includes('fetch failed')
    || lower.includes('network')) {
    return { code: 'network_error', error: message.slice(0, 200) };
  }
  return { code: 'unknown', error: message.slice(0, 200) };
}

async function runConnectivityTest(input: {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  services: SettingsTestKeyServices;
}): Promise<MindosServerResponse<{ ok: true; latency: number } | { ok: false; code: SettingsTestKeyErrorCode; error: string }>> {
  const start = input.services.now?.() ?? Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.services.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const testModel = input.services.testModel ?? defaultTestModel;
    await testModel({
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      signal: controller.signal,
    });
    input.services.clearCompatCacheForBaseUrl?.(input.baseUrl);
    return json({ ok: true, latency: (input.services.now?.() ?? Date.now()) - start });
  } catch (error) {
    return json({ ok: false, ...classifySettingsTestKeyError(error) });
  } finally {
    clearTimeout(timer);
  }
}

async function defaultTestModel(): Promise<void> {
  throw new Error('Provider test service is not configured');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isProviderId(value: string, services: SettingsTestKeyServices): boolean {
  return services.isProviderId ? services.isProviderId(value) : DEFAULT_PROVIDER_IDS.has(value);
}

function isProviderEntryId(value: string, services: SettingsTestKeyServices): boolean {
  return services.isProviderEntryId ? services.isProviderEntryId(value) : value.startsWith('p_');
}
