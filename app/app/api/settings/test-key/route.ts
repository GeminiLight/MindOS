export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { complete } from '@mariozechner/pi-ai';
import { effectiveAiConfig, readBaseUrlCompat, writeSettings, readSettings } from '@/lib/settings';
import { getModelConfig } from '@/lib/agent/model';
import { type ProviderId, isProviderId } from '@/lib/agent/providers';

const TIMEOUT = 15_000;

type ErrorCode = 'auth_error' | 'model_not_found' | 'rate_limited' | 'network_error' | 'unknown';

function classifyPiAiError(err: unknown): { code: ErrorCode; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (err instanceof Error && err.name === 'AbortError')
    return { code: 'network_error', error: 'Request timed out' };

  if (lower.includes('401') || lower.includes('403')
    || (lower.includes('invalid') && lower.includes('key'))
    || lower.includes('authentication') || lower.includes('unauthorized')
    || lower.includes('api key') && (lower.includes('not valid') || lower.includes('incorrect')))
    return { code: 'auth_error', error: 'Invalid API key' };

  if (lower.includes('404') || lower.includes('not found') || lower.includes('does not exist'))
    return { code: 'model_not_found', error: `Model not found: ${msg.slice(0, 200)}` };

  if (lower.includes('429') || lower.includes('rate') || lower.includes('quota'))
    return { code: 'rate_limited', error: 'Rate limited — try again later' };

  if (lower.includes('econnrefused') || lower.includes('enotfound')
    || lower.includes('etimedout') || lower.includes('fetch failed')
    || lower.includes('network'))
    return { code: 'network_error', error: msg.slice(0, 200) };

  return { code: 'unknown', error: msg.slice(0, 200) };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, model, baseUrl } = body as {
      provider?: string;
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    };

    if (!provider || !isProviderId(provider)) {
      return NextResponse.json(
        { ok: false, code: 'unknown', error: 'Invalid provider' },
        { status: 400 },
      );
    }

    const cfg = effectiveAiConfig(provider as ProviderId);
    let resolvedKey = apiKey || '';
    if (!resolvedKey || resolvedKey === '***set***') {
      resolvedKey = cfg.apiKey;
    }

    if (!resolvedKey) {
      return NextResponse.json({ ok: false, code: 'auth_error', error: 'No API key configured' });
    }

    const resolvedModel = model || cfg.model;

    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      const { model: piModel } = getModelConfig({
        provider: provider as ProviderId,
        apiKey: resolvedKey,
        model: resolvedModel || undefined,
        baseUrl: baseUrl || undefined,
      });

      await complete(piModel, {
        messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      }, {
        apiKey: resolvedKey,
        signal: ctrl.signal,
      });

      // Clear stale proxy compat cache for this baseUrl on successful test.
      // Prevents stale 'non-streaming' cache from forcing the fallback path.
      if (baseUrl) {
        const compat = readBaseUrlCompat();
        if (compat[baseUrl]) {
          const s = readSettings();
          const updated = { ...(s.baseUrlCompat ?? {}) };
          delete updated[baseUrl];
          writeSettings({ ...s, baseUrlCompat: updated });
        }
      }

      return NextResponse.json({ ok: true, latency: Date.now() - start });
    } catch (e) {
      return NextResponse.json({ ok: false, ...classifyPiAiError(e) });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return NextResponse.json({ ok: false, code: 'unknown', error: String(err) }, { status: 500 });
  }
}
