export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { applyTemplate } from '@/lib/template';

function maskApiKey(key: string): string {
  if (!key || key.length < 6) return key ? '***' : '';
  return key.slice(0, 6) + '***';
}

export async function GET() {
  try {
    const s = readSettings();
    const home = os.homedir();
    const sep = process.platform === 'win32' ? '\\' : '/';
    const defaultMindRoot = s.mindRoot || [home, 'MindOS', 'mind'].join(sep);
    return NextResponse.json({
      mindRoot: defaultMindRoot,
      homeDir: home,
      platform: process.platform,
      port: s.port ?? 3456,
      mcpPort: s.mcpPort ?? 8781,
      authToken: s.authToken ?? '',
      webPassword: s.webPassword ?? '',
      provider: s.ai.provider,
      anthropicApiKey: maskApiKey(s.ai.providers.anthropic.apiKey),
      anthropicModel: s.ai.providers.anthropic.model,
      openaiApiKey: maskApiKey(s.ai.providers.openai.apiKey),
      openaiModel: s.ai.providers.openai.model,
      openaiBaseUrl: s.ai.providers.openai.baseUrl ?? '',
      guideState: s.guideState ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return p.replace('~', os.homedir());
  if (p === '~') return os.homedir();
  return p;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mindRoot, template, port, mcpPort, authToken, webPassword, ai } = body;

    // Validate required fields
    if (!mindRoot || typeof mindRoot !== 'string') {
      return NextResponse.json({ error: 'mindRoot is required' }, { status: 400 });
    }

    const resolvedRoot = expandHome(mindRoot.trim());

    // Validate ports
    const webPort = typeof port === 'number' ? port : 3456;
    const mcpPortNum = typeof mcpPort === 'number' ? mcpPort : 8781;
    if (webPort < 1024 || webPort > 65535) {
      return NextResponse.json({ error: `Invalid web port: ${webPort}` }, { status: 400 });
    }
    if (mcpPortNum < 1024 || mcpPortNum > 65535) {
      return NextResponse.json({ error: `Invalid MCP port: ${mcpPortNum}` }, { status: 400 });
    }

    // Apply template (copyRecursive has skip-existing protection)
    const dirExists = fs.existsSync(resolvedRoot);

    if (template) {
      applyTemplate(template, resolvedRoot);
    } else if (!dirExists) {
      fs.mkdirSync(resolvedRoot, { recursive: true });
    }

    // Read current running port for portChanged detection
    const current = readSettings();
    const currentPort = current.port ?? 3456;

    // Use the same resolved values that will actually be written to config
    const resolvedAuthToken   = authToken   ?? current.authToken   ?? '';
    const resolvedWebPassword = webPassword ?? '';
    // First-time onboard always needs restart (temporary setup port → user's chosen port).
    // Re-onboard only needs restart if port/path/auth/password actually changed.
    const isFirstTime = current.setupPending === true || !current.mindRoot;
    const needsRestart = isFirstTime || (
      webPort              !== (current.port      ?? 3456) ||
      mcpPortNum           !== (current.mcpPort   ?? 8781) ||
      resolvedRoot         !== (current.mindRoot  || '')    ||
      resolvedAuthToken    !== (current.authToken   ?? '') ||
      resolvedWebPassword  !== (current.webPassword ?? '')
    );

    // Build config
    // Merge AI config: empty apiKey means "keep existing" — never overwrite a
    // configured key with blank just because the user didn't re-enter it.
    let mergedAi = current.ai;
    if (ai) {
      const inAnthropicKey = ai.providers?.anthropic?.apiKey;
      const inOpenaiKey    = ai.providers?.openai?.apiKey;
      mergedAi = {
        provider: ai.provider ?? current.ai.provider,
        providers: {
          anthropic: {
            apiKey: inAnthropicKey || current.ai.providers.anthropic.apiKey,
            model:  ai.providers?.anthropic?.model || current.ai.providers.anthropic.model,
          },
          openai: {
            apiKey:  inOpenaiKey || current.ai.providers.openai.apiKey,
            model:   ai.providers?.openai?.model  || current.ai.providers.openai.model,
            baseUrl: ai.providers?.openai?.baseUrl ?? current.ai.providers.openai.baseUrl ?? '',
          },
        },
      };
    }

    const disabledSkills = body.template === 'zh' ? ['mindos'] : ['mindos-zh'];
    // Determine guide template from setup template
    const guideTemplate = body.template === 'zh' ? 'zh' : body.template === 'empty' ? 'empty' : 'en';
    const config: ServerSettings = {
      ai: mergedAi,
      mindRoot: resolvedRoot,
      port: webPort,
      mcpPort: mcpPortNum,
      authToken: authToken ?? current.authToken,
      webPassword: webPassword ?? '',
      startMode: current.startMode,
      setupPending: false,  // clear the flag
      disabledSkills,
      guideState: {
        active: true,
        dismissed: false,
        template: guideTemplate as 'en' | 'zh' | 'empty',
        step1Done: false,
        askedAI: false,
        nextStepIndex: 0,
      },
    };

    writeSettings(config);

    return NextResponse.json({
      ok: true,
      portChanged: webPort !== currentPort,
      needsRestart,
      newPort: webPort,
    });
  } catch (e) {
    console.error('[/api/setup] Error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { guideState: patch } = body;
    if (!patch || typeof patch !== 'object') {
      return NextResponse.json({ error: 'guideState object required' }, { status: 400 });
    }
    const current = readSettings();
    const existing = current.guideState ?? {
      active: false, dismissed: false, template: 'en' as const,
      step1Done: false, askedAI: false, nextStepIndex: 0,
    };
    // Merge only known fields
    const updated = { ...existing };
    if (typeof patch.dismissed === 'boolean') updated.dismissed = patch.dismissed;
    if (typeof patch.step1Done === 'boolean') updated.step1Done = patch.step1Done;
    if (typeof patch.askedAI === 'boolean') updated.askedAI = patch.askedAI;
    if (typeof patch.nextStepIndex === 'number' && patch.nextStepIndex >= 0) updated.nextStepIndex = patch.nextStepIndex;
    if (typeof patch.active === 'boolean') updated.active = patch.active;

    writeSettings({ ...current, guideState: updated });
    return NextResponse.json({ ok: true, guideState: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
