export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { invalidateCache } from '@/lib/fs';

function maskToken(token: string | undefined): string {
  if (!token) return '';
  // Show first 4 and last 4 chars: xxxx-••••-••••-••••-••••-xxxx
  const parts = token.split('-');
  if (parts.length >= 2) {
    return parts[0] + '-' + parts.slice(1, -1).map(() => '••••').join('-') + '-' + parts[parts.length - 1];
  }
  return token.length > 8 ? token.slice(0, 4) + '••••••••' + token.slice(-4) : '***set***';
}

export async function GET() {
  const settings = readSettings();

  const envValues = {
    AI_PROVIDER:       process.env.AI_PROVIDER || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '***set***' : '',
    ANTHROPIC_MODEL:   process.env.ANTHROPIC_MODEL || '',
    OPENAI_API_KEY:    process.env.OPENAI_API_KEY ? '***set***' : '',
    OPENAI_MODEL:      process.env.OPENAI_MODEL || '',
    OPENAI_BASE_URL:   process.env.OPENAI_BASE_URL || '',
    MIND_ROOT:         process.env.MIND_ROOT || '',
  };

  // Mask API keys
  const anthropic = settings.ai.providers.anthropic;
  const openai    = settings.ai.providers.openai;

  const masked = {
    ai: {
      provider: settings.ai.provider,
      providers: {
        anthropic: {
          apiKey: anthropic?.apiKey ? '***set***' : '',
          model:  anthropic?.model  ?? '',
        },
        openai: {
          apiKey:  openai?.apiKey  ? '***set***' : '',
          model:   openai?.model   ?? '',
          baseUrl: openai?.baseUrl ?? '',
        },
      },
    },
    mindRoot: settings.mindRoot,
    webPassword: settings.webPassword ? '***set***' : '',
    authToken: maskToken(settings.authToken),
    mcpPort: settings.mcpPort ?? 8781,
    agent: settings.agent ?? {},
    envOverrides: {
      AI_PROVIDER:       !!process.env.AI_PROVIDER,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL:   !!process.env.ANTHROPIC_MODEL,
      OPENAI_API_KEY:    !!process.env.OPENAI_API_KEY,
      OPENAI_MODEL:      !!process.env.OPENAI_MODEL,
      OPENAI_BASE_URL:   !!process.env.OPENAI_BASE_URL,
      MIND_ROOT:         !!process.env.MIND_ROOT,
    },
    envValues,
  };
  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ServerSettings>;
    const current = readSettings();

    // Merge providers, preserving masked keys
    const incomingAnthropic = body.ai?.providers?.anthropic;
    const incomingOpenai    = body.ai?.providers?.openai;
    const curAnthropic      = current.ai.providers.anthropic;
    const curOpenai         = current.ai.providers.openai;

    // Resolve webPassword: '***set***' means keep existing, '' means clear, anything else = new value
    const incomingWebPassword = body.webPassword;
    const resolvedWebPassword = incomingWebPassword === '***set***'
      ? current.webPassword
      : (incomingWebPassword ?? current.webPassword);

    // authToken is read-only via POST (use /api/settings/reset-token to regenerate)
    // but allow clearing it by passing empty string
    const incomingAuthToken = body.authToken;
    const resolvedAuthToken = (incomingAuthToken === '' || incomingAuthToken === undefined)
      ? (incomingAuthToken === '' ? '' : current.authToken)
      : current.authToken;

    const next: ServerSettings = {
      ai: {
        provider: body.ai?.provider ?? current.ai.provider,
        providers: {
          anthropic: {
            ...curAnthropic,
            ...(incomingAnthropic ?? {}),
            apiKey: incomingAnthropic?.apiKey === '***set***'
              ? (curAnthropic.apiKey ?? '')
              : (incomingAnthropic?.apiKey ?? curAnthropic.apiKey ?? ''),
            model: incomingAnthropic?.model ?? curAnthropic.model ?? 'claude-sonnet-4-6',
          },
          openai: {
            ...curOpenai,
            ...(incomingOpenai ?? {}),
            apiKey: incomingOpenai?.apiKey === '***set***'
              ? (curOpenai.apiKey ?? '')
              : (incomingOpenai?.apiKey ?? curOpenai.apiKey ?? ''),
            model: incomingOpenai?.model ?? curOpenai.model ?? 'gpt-5.4',
          },
        },
      },
      mindRoot: body.mindRoot ?? current.mindRoot,
      agent: body.agent ?? current.agent,
      webPassword: resolvedWebPassword,
      authToken: resolvedAuthToken,
      port: typeof body.port === 'number' ? body.port : current.port,
      mcpPort: typeof body.mcpPort === 'number' ? body.mcpPort : current.mcpPort,
      startMode: body.startMode ?? current.startMode,
    };

    writeSettings(next);
    if (next.mindRoot !== current.mindRoot) invalidateCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
