export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { effectiveAiConfig } from '@/lib/settings';

const TIMEOUT = 10_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, baseUrl } = body as {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
    };

    if (provider !== 'anthropic' && provider !== 'openai') {
      return NextResponse.json({ ok: false, error: 'Invalid provider' }, { status: 400 });
    }

    const cfg = effectiveAiConfig();
    let resolvedKey = apiKey || '';
    if (!resolvedKey || resolvedKey === '***set***') {
      resolvedKey = provider === 'anthropic' ? cfg.anthropicApiKey : cfg.openaiApiKey;
    }

    if (!resolvedKey) {
      return NextResponse.json({ ok: false, error: 'No API key configured' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      let models: string[] = [];

      if (provider === 'openai') {
        const resolvedBaseUrl = (baseUrl || cfg.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const res = await fetch(`${resolvedBaseUrl}/models`, {
          headers: { Authorization: `Bearer ${resolvedKey}` },
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          return NextResponse.json({
            ok: false,
            error: `Failed to list models: HTTP ${res.status} ${errBody.slice(0, 200)}`,
          });
        }

        const json = await res.json();
        if (Array.isArray(json?.data)) {
          models = json.data
            .map((m: any) => m.id as string)
            .filter(Boolean)
            .sort((a: string, b: string) => a.localeCompare(b));
        }
      } else {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': resolvedKey,
            'anthropic-version': '2023-06-01',
          },
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          return NextResponse.json({
            ok: false,
            error: `Failed to list models: HTTP ${res.status} ${errBody.slice(0, 200)}`,
          });
        }

        const json = await res.json();
        if (Array.isArray(json?.data)) {
          models = json.data
            .map((m: any) => m.id as string)
            .filter(Boolean)
            .sort((a: string, b: string) => a.localeCompare(b));
        }
      }

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
