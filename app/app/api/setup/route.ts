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
      port: s.port ?? 3000,
      mcpPort: s.mcpPort ?? 8787,
      authToken: s.authToken ?? '',
      webPassword: s.webPassword ?? '',
      provider: s.ai.provider,
      anthropicApiKey: maskApiKey(s.ai.providers.anthropic.apiKey),
      anthropicModel: s.ai.providers.anthropic.model,
      openaiApiKey: maskApiKey(s.ai.providers.openai.apiKey),
      openaiModel: s.ai.providers.openai.model,
      openaiBaseUrl: s.ai.providers.openai.baseUrl ?? '',
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
    const webPort = typeof port === 'number' ? port : 3000;
    const mcpPortNum = typeof mcpPort === 'number' ? mcpPort : 8787;
    if (webPort < 1024 || webPort > 65535) {
      return NextResponse.json({ error: `Invalid web port: ${webPort}` }, { status: 400 });
    }
    if (mcpPortNum < 1024 || mcpPortNum > 65535) {
      return NextResponse.json({ error: `Invalid MCP port: ${mcpPortNum}` }, { status: 400 });
    }

    // Apply template if mindRoot doesn't exist or is empty
    const dirExists = fs.existsSync(resolvedRoot);
    let dirEmpty = true;
    if (dirExists) {
      try {
        const entries = fs.readdirSync(resolvedRoot).filter(e => !e.startsWith('.'));
        dirEmpty = entries.length === 0;
      } catch { /* treat as empty */ }
    }

    if (template && (!dirExists || dirEmpty)) {
      applyTemplate(template, resolvedRoot);
    } else if (!dirExists) {
      fs.mkdirSync(resolvedRoot, { recursive: true });
    }

    // Read current running port for portChanged detection
    const current = readSettings();
    const currentPort = current.port ?? 3000;

    // Use the same resolved values that will actually be written to config
    const resolvedAuthToken   = authToken   ?? current.authToken   ?? '';
    const resolvedWebPassword = webPassword ?? '';
    // First-time onboard always needs restart (temporary setup port → user's chosen port).
    // Re-onboard only needs restart if port/path/auth/password actually changed.
    const isFirstTime = current.setupPending === true || !current.mindRoot;
    const needsRestart = isFirstTime || (
      webPort              !== (current.port      ?? 3000) ||
      mcpPortNum           !== (current.mcpPort   ?? 8787) ||
      resolvedRoot         !== (current.mindRoot  || '')    ||
      resolvedAuthToken    !== (current.authToken   ?? '') ||
      resolvedWebPassword  !== (current.webPassword ?? '')
    );

    // Build config
    const disabledSkills = body.template === 'zh' ? ['mindos'] : ['mindos-zh'];
    const config: ServerSettings = {
      ai: ai ?? current.ai,
      mindRoot: resolvedRoot,
      port: webPort,
      mcpPort: mcpPortNum,
      authToken: authToken ?? current.authToken,
      webPassword: webPassword ?? '',
      startMode: current.startMode,
      setupPending: false,  // clear the flag
      disabledSkills,
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
