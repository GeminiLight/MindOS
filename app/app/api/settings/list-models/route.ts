export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { effectiveAiConfig } from '@/lib/settings';
import { type ProviderId, isProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';

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

    const cfg = effectiveAiConfig();
    let resolvedKey = apiKey || '';
    if (!resolvedKey || resolvedKey === '***set***') {
      resolvedKey = cfg.provider === provider ? cfg.apiKey : '';
    }

    if (!resolvedKey) {
      return NextResponse.json({ ok: false, error: 'No API key configured' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      const models = await fetchModels(provider as ProviderId, resolvedKey, baseUrl || (cfg.provider === provider ? cfg.baseUrl : '') || '', ctrl.signal);
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
  const preset = PROVIDER_PRESETS[provider];

  if (provider === 'anthropic') {
    return fetchAnthropicModels(apiKey, signal);
  }

  // OpenAI-compatible providers (openai, groq, deepseek, xai, openrouter, cerebras, mistral)
  const endpoint = resolveListModelsUrl(provider, baseUrl);
  return fetchOpenAICompatModels(endpoint, apiKey, preset.authHeader, signal);
}

function resolveListModelsUrl(provider: ProviderId, baseUrl: string): string {
  const preset = PROVIDER_PRESETS[provider];

  if (baseUrl) {
    return baseUrl.replace(/\/+$/, '') + '/models';
  }

  if (preset.listModelsEndpoint) {
    return preset.listModelsEndpoint;
  }

  if (preset.defaultBaseUrl) {
    return preset.defaultBaseUrl.replace(/\/+$/, '') + '/models';
  }

  // Infer from piProvider and known base URLs
  const knownBases: Partial<Record<ProviderId, string>> = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    xai: 'https://api.x.ai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    mistral: 'https://api.mistral.ai/v1',
    cerebras: 'https://api.cerebras.ai/v1',
    deepseek: 'https://api.deepseek.com/v1',
  };

  const base = knownBases[provider] || 'https://api.openai.com/v1';
  return base + '/models';
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
  endpoint: string, apiKey: string, authHeader: string, signal: AbortSignal,
): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (authHeader === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (authHeader === 'x-api-key') {
    headers['x-api-key'] = apiKey;
  }

  const res = await fetch(endpoint, { headers, signal });

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
