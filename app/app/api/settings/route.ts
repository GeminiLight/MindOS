import { NextRequest, NextResponse } from 'next/server';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { invalidateCache } from '@/lib/fs';

export async function GET() {
  const settings = readSettings();

  const envValues = {
    AI_PROVIDER: process.env.AI_PROVIDER || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '***set***' : '',
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***set***' : '',
    OPENAI_MODEL: process.env.OPENAI_MODEL || '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
    MIND_ROOT: process.env.MIND_ROOT || '',
  };

  // Return raw settings-file values so user can edit them.
  // Mask API keys from the file (not env).
  const masked = {
    ai: {
      provider: settings.ai.provider,
      anthropicModel: settings.ai.anthropicModel,
      anthropicApiKey: settings.ai.anthropicApiKey ? '***set***' : '',
      openaiModel: settings.ai.openaiModel,
      openaiApiKey: settings.ai.openaiApiKey ? '***set***' : '',
      openaiBaseUrl: settings.ai.openaiBaseUrl,
    },
    mindRoot: settings.mindRoot,
    envOverrides: {
      AI_PROVIDER: !!process.env.AI_PROVIDER,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL: !!process.env.ANTHROPIC_MODEL,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      OPENAI_MODEL: !!process.env.OPENAI_MODEL,
      OPENAI_BASE_URL: !!process.env.OPENAI_BASE_URL,
      MIND_ROOT: !!process.env.MIND_ROOT,
    },
    envValues,
  };
  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ServerSettings>;
    const current = readSettings();

    const next: ServerSettings = {
      ai: {
        ...current.ai,
        ...(body.ai ?? {}),
        anthropicApiKey:
          body.ai?.anthropicApiKey === '***set***'
            ? current.ai.anthropicApiKey
            : (body.ai?.anthropicApiKey ?? current.ai.anthropicApiKey),
        openaiApiKey:
          body.ai?.openaiApiKey === '***set***'
            ? current.ai.openaiApiKey
            : (body.ai?.openaiApiKey ?? current.ai.openaiApiKey),
      },
      mindRoot: body.mindRoot ?? current.mindRoot,
    };

    writeSettings(next);
    // Invalidate file tree cache when MIND_ROOT changes
    if (next.mindRoot !== current.mindRoot) {
      invalidateCache();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
