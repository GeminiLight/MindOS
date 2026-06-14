export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';

function requiredQuery(name: string, value: string | null): string {
  if (!value || value.trim().length === 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Missing ${name}`);
  }
  return value.trim();
}

export async function GET(req: NextRequest) {
  try {
    const pluginId = requiredQuery('pluginId', req.nextUrl.searchParams.get('pluginId'));
    const settings = readSettings();
    const stylesheet = await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      await manager.loadEnabledPlugins();
      return manager.readScopedStyleSheet(pluginId);
    });

    return NextResponse.json({
      ok: true,
      stylesheet,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
