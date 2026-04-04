export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { applyTemplate } from '@/lib/template';
import { expandSetupPathHome } from './path-utils';
import { type ProviderId, isProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';

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

    // Build providerConfigs for frontend (masked keys)
    const providerConfigs: Record<string, { model: string; baseUrl?: string; apiKeyMask: string }> = {};
    for (const [id, cfg] of Object.entries(s.ai.providers)) {
      if (!cfg) continue;
      providerConfigs[id] = {
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        apiKeyMask: maskApiKey(cfg.apiKey),
      };
    }

    // Backward-compatible legacy fields
    const anthropicCfg = s.ai.providers.anthropic ?? { apiKey: '', model: 'claude-sonnet-4-6' };
    const openaiCfg = s.ai.providers.openai ?? { apiKey: '', model: 'gpt-5.4', baseUrl: '' };

    return NextResponse.json({
      mindRoot: defaultMindRoot,
      homeDir: home,
      platform: process.platform,
      port: s.port ?? 3456,
      mcpPort: s.mcpPort ?? 8781,
      authToken: s.authToken ?? '',
      webPassword: s.webPassword ?? '',
      provider: s.ai.provider,
      // Legacy fields for backward compat
      anthropicApiKey: maskApiKey(anthropicCfg.apiKey),
      anthropicModel: anthropicCfg.model,
      openaiApiKey: maskApiKey(openaiCfg.apiKey),
      openaiModel: openaiCfg.model,
      openaiBaseUrl: openaiCfg.baseUrl ?? '',
      // New dynamic format
      providerConfigs,
      guideState: s.guideState ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mindRoot, template, port, mcpPort, authToken, webPassword, ai } = body;

    // Validate required fields
    if (!mindRoot || typeof mindRoot !== 'string') {
      return NextResponse.json({ error: 'mindRoot is required' }, { status: 400 });
    }

    const resolvedRoot = expandSetupPathHome(mindRoot.trim());

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
      const newProvider = ai.provider && isProviderId(ai.provider) ? ai.provider : current.ai.provider;
      const mergedProviders = { ...current.ai.providers };

      // Merge each provider's config from the incoming payload
      if (ai.providers && typeof ai.providers === 'object') {
        for (const [id, inCfg] of Object.entries(ai.providers as Record<string, any>)) {
          if (!isProviderId(id) || !inCfg) continue;
          const existing = mergedProviders[id] ?? { apiKey: '', model: PROVIDER_PRESETS[id].defaultModel };
          mergedProviders[id] = {
            apiKey: inCfg.apiKey || existing.apiKey,
            model: inCfg.model || existing.model,
            ...(inCfg.baseUrl !== undefined ? { baseUrl: inCfg.baseUrl } : existing.baseUrl ? { baseUrl: existing.baseUrl } : {}),
          };
        }
      }

      mergedAi = { provider: newProvider, providers: mergedProviders };
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
      setupPort: undefined, // clear temporary setup port (zombie cleanup)
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
    if (typeof patch.walkthroughStep === 'number' && patch.walkthroughStep >= 0) updated.walkthroughStep = patch.walkthroughStep;
    if (typeof patch.walkthroughDismissed === 'boolean') updated.walkthroughDismissed = patch.walkthroughDismissed;

    writeSettings({ ...current, guideState: updated });
    return NextResponse.json({ ok: true, guideState: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
