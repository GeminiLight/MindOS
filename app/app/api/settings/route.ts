import { NextRequest, NextResponse } from 'next/server';
import { readSettings, writeSettings, effectiveAiConfig, effectiveSopRoot, ServerSettings } from '@/lib/settings';

export async function GET() {
  const settings = readSettings();
  const effective = effectiveAiConfig();

  // Use effective values (env overrides applied) so UI reflects what's actually active
  const masked = {
    ai: {
      provider: effective.provider,
      anthropicModel: effective.anthropicModel,
      anthropicApiKey: effective.anthropicApiKey ? '***set***' : '',
      openaiModel: effective.openaiModel,
      openaiApiKey: effective.openaiApiKey ? '***set***' : '',
      openaiBaseUrl: effective.openaiBaseUrl,
    },
    sopRoot: settings.sopRoot,
    envOverrides: {
      AI_PROVIDER: !!process.env.AI_PROVIDER,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL: !!process.env.ANTHROPIC_MODEL,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      OPENAI_MODEL: !!process.env.OPENAI_MODEL,
      OPENAI_BASE_URL: !!process.env.OPENAI_BASE_URL,
      MIND_ROOT: !!process.env.MIND_ROOT,
    },
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
        // Don't overwrite key if client sends the masked placeholder
        anthropicApiKey:
          body.ai?.anthropicApiKey === '***set***'
            ? current.ai.anthropicApiKey
            : (body.ai?.anthropicApiKey ?? current.ai.anthropicApiKey),
        openaiApiKey:
          body.ai?.openaiApiKey === '***set***'
            ? current.ai.openaiApiKey
            : (body.ai?.openaiApiKey ?? current.ai.openaiApiKey),
      },
      sopRoot: body.sopRoot ?? current.sopRoot,
    };

    writeSettings(next);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
