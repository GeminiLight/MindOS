export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { effectiveAiConfig } from '@/lib/settings';
import { type ProviderId, isProviderId, PROVIDER_PRESETS, getDefaultBaseUrl } from '@/lib/agent/providers';

const TIMEOUT = 10_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, baseUrl } = body as {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    if (!provider || !isProviderId(provider)) {
      return NextResponse.json({ ok: false, error: 'Invalid provider' }, { status: 400 });
    }

    const preset = PROVIDER_PRESETS[provider as ProviderId];
    if (!preset.supportsListModels) {
      return NextResponse.json({ ok: false, error: 'This provider does not support listing models' });
    }

    const cfg = effectiveAiConfig(provider as ProviderId);
    let resolvedKey = apiKey || '';
    if (!resolvedKey || resolvedKey === '***set***') {
      resolvedKey = cfg.apiKey;
    }

    if (!resolvedKey) {
      return NextResponse.json({ ok: false, error: 'No API key configured' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      const models = await fetchModels(provider as ProviderId, resolvedKey, baseUrl || cfg.baseUrl || '', ctrl.signal);
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
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

async function fetchModels(provider: ProviderId, apiKey: string, baseUrl: string, signal: AbortSignal): Promise<string[]> {
  if (provider === 'anthropic') {
    return fetchAnthropicModels(apiKey, signal);
  }

  const endpoint = resolveListModelsUrl(provider, baseUrl);
  return fetchOpenAICompatModels(endpoint, apiKey, signal);
}

function resolveListModelsUrl(provider: ProviderId, baseUrl: string): string {
  if (baseUrl) {
    return baseUrl.replace(/\/+$/, '') + '/models';
  }

  const base = getDefaultBaseUrl(provider);
  if (base) {
    return base.replace(/\/+$/, '') + '/models';
  }

  return 'https://api.openai.com/v1/models';
}

async function fetchAnthropicModels(apiKey: string, signal: AbortSignal): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Failed to list models: HTTP ${res.status} ${errBody.slice(0, 200)}`);
  }

  const json = await res.json();
  if (Array.isArray(json?.data)) {
    return json.data.map((m: any) => m.id as string).filter(Boolean).sort();
  }
  return [];
}

async function fetchOpenAICompatModels(
  endpoint: string, apiKey: string, signal: AbortSignal,
): Promise<string[]> {
  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Failed to list models: HTTP ${res.status} ${errBody.slice(0, 200)}`);
  }

  const json = await res.json();
  if (Array.isArray(json?.data)) {
    return json.data.map((m: any) => m.id as string).filter(Boolean).sort();
  }
  return [];
}
