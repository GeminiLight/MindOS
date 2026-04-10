export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { invalidateCache } from '@/lib/fs';
import { ALL_PROVIDER_IDS, getApiKeyEnvVar, getApiKeyFromEnv } from '@/lib/agent/providers';
import { parseProviders } from '@/lib/custom-endpoints';
import { handleRouteErrorSimple } from '@/lib/errors';

function maskToken(token: string | undefined): string {
  if (!token) return '';
  const parts = token.split('-');
  if (parts.length >= 2) {
    return parts[0] + '-' + parts.slice(1, -1).map(() => '••••').join('-') + '-' + parts[parts.length - 1];
  }
  return token.length > 8 ? token.slice(0, 4) + '••••••••' + token.slice(-4) : '***set***';
}

export async function GET() {
  const settings = readSettings();

  // Build env values/overrides dynamically from all provider presets
  const envOverrides: Record<string, boolean> = {
    AI_PROVIDER: !!process.env.AI_PROVIDER,
    MIND_ROOT:   !!process.env.MIND_ROOT,
  };
  const envValues: Record<string, string> = {
    AI_PROVIDER: process.env.AI_PROVIDER || '',
    MIND_ROOT:   process.env.MIND_ROOT || '',
  };

  for (const id of ALL_PROVIDER_IDS) {
    const envKey = getApiKeyEnvVar(id);
    if (envKey) {
      envOverrides[envKey] = !!getApiKeyFromEnv(id);
      envValues[envKey] = getApiKeyFromEnv(id) ? '***set***' : '';
    }
  }

  return NextResponse.json({
    ai: {
      activeProvider: settings.ai.activeProvider,
      providers: settings.ai.providers,
    },
    mindRoot: settings.mindRoot,
    webPassword: settings.webPassword ?? '',
    authToken: maskToken(settings.authToken),
    port: Number(process.env.MINDOS_WEB_PORT) || settings.port || 3456,
    mcpPort: settings.mcpPort ?? 8781,
    agent: settings.agent ?? {},
    envOverrides,
    envValues,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ServerSettings>;
    const current = readSettings();

    // Resolve AI config
    const resolvedAi = { ...current.ai };
    if (body.ai) {
      if (body.ai.activeProvider !== undefined) resolvedAi.activeProvider = body.ai.activeProvider;
      if (body.ai.providers !== undefined) resolvedAi.providers = parseProviders(body.ai.providers);
    }

    const resolvedWebPassword = body.webPassword ?? current.webPassword;

    // authToken is read-only via POST (use /api/settings/reset-token to regenerate)
    // but allow clearing it by passing empty string
    const incomingAuthToken = body.authToken;
    const resolvedAuthToken = (incomingAuthToken === '' || incomingAuthToken === undefined)
      ? (incomingAuthToken === '' ? '' : current.authToken)
      : current.authToken;

    // Handle connectionMode: validate if provided, otherwise keep existing
    let resolvedConnectionMode = current.connectionMode ?? { cli: true, mcp: false };
    if (body.connectionMode && typeof body.connectionMode === 'object') {
      const incomingMode = body.connectionMode as Record<string, unknown>;
      if (typeof incomingMode.cli === 'boolean' && typeof incomingMode.mcp === 'boolean') {
        resolvedConnectionMode = {
          cli: incomingMode.cli,
          mcp: incomingMode.mcp,
        };
      }
    }

    const next: ServerSettings = {
      ai: resolvedAi,
      mindRoot: body.mindRoot ?? current.mindRoot,
      agent: body.agent ?? current.agent,
      webPassword: resolvedWebPassword,
      authToken: resolvedAuthToken,
      port: typeof body.port === 'number' ? body.port : current.port,
      mcpPort: typeof body.mcpPort === 'number' ? body.mcpPort : current.mcpPort,
      startMode: body.startMode ?? current.startMode,
      connectionMode: resolvedConnectionMode,
    };

    writeSettings(next);
    // Clear proxy compat cache when AI config changes — stale cache causes
    // the non-streaming fallback to be used even when streaming would work.
    if (JSON.stringify(next.ai) !== JSON.stringify(current.ai)) {
      const { readSettings: rs, writeSettings: ws } = await import('@/lib/settings');
      const s = rs();
      if (s.baseUrlCompat && Object.keys(s.baseUrlCompat).length > 0) {
        ws({ ...s, baseUrlCompat: {} });
      }
    }
    if (next.mindRoot !== current.mindRoot) invalidateCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
