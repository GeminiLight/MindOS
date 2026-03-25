export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { effectiveAiConfig } from '@/lib/settings';

const TIMEOUT = 10_000;

type ErrorCode = 'auth_error' | 'model_not_found' | 'rate_limited' | 'network_error' | 'unknown';

function classifyError(status: number, body: string): { code: ErrorCode; error: string } {
  if (status === 401 || status === 403) return { code: 'auth_error', error: 'Invalid API key' };
  if (status === 404) return { code: 'model_not_found', error: 'Model not found' };
  if (status === 429) return { code: 'rate_limited', error: 'Rate limited' };
  // Try to extract error message from response body
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message || parsed?.error || '';
    if (typeof msg === 'string' && msg.length > 0) return { code: 'unknown', error: msg.slice(0, 200) };
  } catch { /* not JSON */ }
  return { code: 'unknown', error: `HTTP ${status}` };
}

async function testAnthropic(apiKey: string, model: string): Promise<{ ok: boolean; latency?: number; code?: ErrorCode; error?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: ctrl.signal,
    });
    const latency = Date.now() - start;
    if (res.ok) return { ok: true, latency };
    const body = await res.text();
    return { ok: false, ...classifyError(res.status, body) };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, code: 'network_error', error: 'Request timed out' };
    return { ok: false, code: 'network_error', error: e instanceof Error ? e.message : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function testOpenAI(apiKey: string, model: string, baseUrl: string): Promise<{ ok: boolean; latency?: number; code?: ErrorCode; error?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: ctrl.signal,
    });
    const latency = Date.now() - start;
    if (res.ok) {
      // `/api/ask` always sends tool definitions, so key test should verify this
      // compatibility as well (not just plain chat completion).
      const toolRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'hi' },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'noop',
              description: 'No-op function used for compatibility checks.',
              parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
            },
          }],
          tool_choice: 'none',
        }),
        signal: ctrl.signal,
      });

      if (toolRes.ok) return { ok: true, latency };

      const toolBody = await toolRes.text();
      const toolErr = classifyError(toolRes.status, toolBody);
      return {
        ok: false,
        code: toolErr.code,
        error: `Model endpoint passes basic test but is incompatible with agent tool calls: ${toolErr.error}`,
      };
    }
    const body = await res.text();
    return { ok: false, ...classifyError(res.status, body) };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, code: 'network_error', error: 'Request timed out' };
    return { ok: false, code: 'network_error', error: e instanceof Error ? e.message : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
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

    if (provider !== 'anthropic' && provider !== 'openai') {
      return NextResponse.json({ ok: false, code: 'unknown', error: 'Invalid provider' }, { status: 400 });
    }

    // Resolve actual API key: use provided key, fallback to config/env for masked or missing
    const cfg = effectiveAiConfig();
    let resolvedKey = apiKey || '';
    if (!resolvedKey || resolvedKey === '***set***') {
      resolvedKey = provider === 'anthropic' ? cfg.anthropicApiKey : cfg.openaiApiKey;
    }

    if (!resolvedKey) {
      return NextResponse.json({ ok: false, code: 'auth_error', error: 'No API key configured' });
    }

    const resolvedModel = model || (provider === 'anthropic' ? cfg.anthropicModel : cfg.openaiModel);

    const result = provider === 'anthropic'
      ? await testAnthropic(resolvedKey, resolvedModel)
      : await testOpenAI(resolvedKey, resolvedModel, baseUrl || cfg.openaiBaseUrl);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, code: 'unknown', error: String(err) }, { status: 500 });
  }
}
