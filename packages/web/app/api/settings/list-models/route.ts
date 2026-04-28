export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getModels as piGetModels } from '@mariozechner/pi-ai';
import { effectiveAiConfig, readSettings } from '@/lib/settings';
import { type ProviderId, isProviderId, PROVIDER_PRESETS, toPiProvider, getDefaultBaseUrl, getProviderApiType, buildCompatEndpointCandidates } from '@/lib/agent/providers';
import { isProviderEntryId, findProvider } from '@/lib/custom-endpoints';
import { handleRouteErrorSimple } from '@/lib/errors';

const TIMEOUT = 10_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, baseUrl } = body as {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    // Handle provider entry ID (p_*) — look up from unified providers list
    if (provider && isProviderEntryId(provider)) {
      const settings = readSettings();
      const entry = findProvider(settings.ai.providers, provider);
      if (!entry) {
        return NextResponse.json({ ok: false, error: 'Provider not found' }, { status: 404 });
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

      try {
        const models = await fetchModels(entry.protocol, apiKey || entry.apiKey, baseUrl || entry.baseUrl, ctrl.signal);
        return NextResponse.json({ ok: true, models });
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          return NextResponse.json({ ok: false, error: 'Request timed out' });
        }
        return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Network error' });
      } finally {
        clearTimeout(timer);
      }
    }

    // Handle built-in protocol ID (openai, anthropic, etc.)
    if (!provider || !isProviderId(provider)) {
      return NextResponse.json({ ok: false, error: 'Invalid provider' }, { status: 400 });
    }

    const preset = PROVIDER_PRESETS[provider as ProviderId];

    // Providers without remote list-models API: return static list from pi-ai registry
    if (!preset.supportsListModels) {
      const models = getRegistryModels(provider as ProviderId);
      return NextResponse.json({ ok: true, models });
    }

    const cfg = effectiveAiConfig(provider as ProviderId);
    let resolvedKey = apiKey || '';
    if (!resolvedKey) {
      resolvedKey = cfg.apiKey;
    }

    // Allow keyless requests when an explicit baseUrl is provided (local servers like Ollama)
    const effectiveBaseUrl = baseUrl || cfg.baseUrl || '';
    if (!resolvedKey && !effectiveBaseUrl) {
      return NextResponse.json({ ok: false, error: 'No API key configured' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      const models = await fetchModels(provider as ProviderId, resolvedKey, effectiveBaseUrl, ctrl.signal);
      return NextResponse.json({ ok: true, models });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return NextResponse.json({ ok: false, error: 'Request timed out' });
      }
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Network error' });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

/** Return model IDs from pi-ai's static registry for providers without a remote /models API. */
function getRegistryModels(provider: ProviderId): string[] {
  try {
    const models = piGetModels(toPiProvider(provider) as any);
    return models.map((m: any) => m.id as string).filter(Boolean).sort();
  } catch {
    return [];
  }
}

async function fetchModels(provider: ProviderId, apiKey: string, baseUrl: string, signal: AbortSignal): Promise<string[]> {
  const apiType = getProviderApiType(provider);
  const endpoints = resolveListModelsUrls(provider, baseUrl, apiType);
  return fetchCompatModels(endpoints, apiKey, apiType, signal);
}

function resolveListModelsUrls(provider: ProviderId, baseUrl: string, apiType: string): string[] {
  if (baseUrl) {
    return buildCompatEndpointCandidates(baseUrl, '/models', apiType);
  }

  const base = getDefaultBaseUrl(provider);
  if (base) {
    return buildCompatEndpointCandidates(base, '/models', apiType);
  }

  return ['https://api.openai.com/v1/models'];
}

async function fetchCompatModels(
  endpoints: string[], apiKey: string, apiType: string, signal: AbortSignal,
): Promise<string[]> {
  let lastError = 'No endpoint candidates';
  const attempted: string[] = [];

  for (const endpoint of endpoints) {
    attempted.push(endpoint);
    const headers: Record<string, string> = {};
    if (apiType === 'anthropic-messages') {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, { headers, signal });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      lastError = `HTTP ${res.status} @ ${endpoint}: ${errBody.slice(0, 200)}`;
      if (res.status === 400 || res.status === 404 || res.status === 405) continue;
      throw new Error(`Failed to list models: ${lastError}`);
    }

    const json = await res.json();
    if (Array.isArray(json?.data)) {
      return json.data.map((m: any) => m.id as string).filter(Boolean).sort();
    }

    if (Array.isArray(json?.models)) {
      return json.models.map((m: any) => (typeof m === 'string' ? m : m?.id)).filter(Boolean).sort();
    }

    throw new Error(`Failed to list models: incompatible response shape from ${endpoint}; tried ${attempted.length} endpoint candidate(s)`);
  }

  throw new Error(`Failed to list models: ${lastError}; tried ${attempted.length} endpoint candidate(s)`);
}
