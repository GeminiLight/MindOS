export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { applyTemplate } from '@/lib/template';
import { expandSetupPathHome } from './path-utils';
import { type ProviderId, isProviderId, PROVIDER_PRESETS } from '@/lib/agent/providers';
import { type Provider, generateProviderId, findProvider } from '@/lib/custom-endpoints';

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
    const providerConfigs = s.ai.providers.map(p => ({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      model: p.model,
      baseUrl: p.baseUrl,
      apiKeyMask: maskApiKey(p.apiKey),
    }));

    return NextResponse.json({
      mindRoot: defaultMindRoot,
      homeDir: home,
      platform: process.platform,
      port: s.port ?? 3456,
      mcpPort: s.mcpPort ?? 8781,
      authToken: s.authToken ?? '',
      webPassword: s.webPassword ?? '',
      activeProvider: s.ai.activeProvider,
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
    const { mindRoot, template, port, mcpPort, authToken, webPassword, ai, connectionMode } = body;

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
      const mergedProviders = [...current.ai.providers];

      if (Array.isArray(ai.providers)) {
        // ── New format: Provider[] array (from unified onboarding/settings) ──
        for (const incoming of ai.providers as Array<Record<string, any>>) {
          if (!incoming || typeof incoming !== 'object' || !incoming.id) continue;
          if (!isProviderId(incoming.protocol)) continue;

          const existingIdx = mergedProviders.findIndex(p => p.id === incoming.id);
          const existing = existingIdx >= 0 ? mergedProviders[existingIdx] : null;

          const merged: Provider = {
            id: incoming.id,
            name: incoming.name || existing?.name || incoming.protocol,
            protocol: incoming.protocol,
            apiKey: incoming.apiKey || existing?.apiKey || '',
            model: incoming.model || existing?.model || PROVIDER_PRESETS[incoming.protocol as ProviderId]?.defaultModel || '',
            baseUrl: incoming.baseUrl !== undefined ? incoming.baseUrl : (existing?.baseUrl ?? ''),
          };

          if (existingIdx >= 0) {
            mergedProviders[existingIdx] = merged;
          } else {
            mergedProviders.push(merged);
          }
        }

        // Active provider: use the ID directly from the new format
        const newActiveProvider = ai.activeProvider || current.ai.activeProvider;
        mergedAi = { activeProvider: newActiveProvider, providers: mergedProviders };
      } else if (ai.providers && typeof ai.providers === 'object') {
        // ── Legacy format: Record<ProviderId, config> (backward compat) ──
        for (const [id, inCfg] of Object.entries(ai.providers as Record<string, any>)) {
          if (!isProviderId(id) || !inCfg) continue;
          const preset = PROVIDER_PRESETS[id];
          const existingIdx = mergedProviders.findIndex(p => p.protocol === id);
          const existing = existingIdx >= 0 ? mergedProviders[existingIdx] : null;

          const merged: Provider = {
            id: existing?.id ?? generateProviderId(),
            name: existing?.name ?? preset?.name ?? id,
            protocol: id,
            apiKey: inCfg.apiKey || existing?.apiKey || '',
            model: inCfg.model || existing?.model || preset?.defaultModel || '',
            baseUrl: inCfg.baseUrl !== undefined ? (inCfg.baseUrl || '') : (existing?.baseUrl ?? ''),
          };

          if (existingIdx >= 0) {
            mergedProviders[existingIdx] = merged;
          } else {
            mergedProviders.push(merged);
          }
        }

        // Legacy: determine active by protocol match
        let newActiveProvider = current.ai.activeProvider;
        if (ai.provider && isProviderId(ai.provider)) {
          const match = mergedProviders.find(p => p.protocol === ai.provider);
          if (match) newActiveProvider = match.id;
        }
        mergedAi = { activeProvider: newActiveProvider, providers: mergedProviders };
      }
    }

    const disabledSkills = body.template === 'zh' ? ['mindos'] : ['mindos-zh'];
    // Determine guide template from setup template
    const guideTemplate = body.template === 'zh' ? 'zh' : body.template === 'empty' ? 'empty' : 'en';
    
    // Validate and build connectionMode
    let resolvedConnectionMode = current.connectionMode ?? { cli: true, mcp: false };
    if (connectionMode && typeof connectionMode === 'object') {
      if (typeof connectionMode.cli === 'boolean' && typeof connectionMode.mcp === 'boolean') {
        resolvedConnectionMode = connectionMode;
      }
    }

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
      connectionMode: resolvedConnectionMode,
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
