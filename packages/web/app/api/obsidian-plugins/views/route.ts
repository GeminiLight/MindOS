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
    const viewType = requiredQuery('viewType', req.nextUrl.searchParams.get('viewType'));
    const sourcePath = req.nextUrl.searchParams.get('sourcePath')?.trim() || undefined;
    const settings = readSettings();
    const view = await withObsidianPluginRuntime(settings.mindRoot, (manager) => (
      manager.renderView(pluginId, viewType, sourcePath ? { sourcePath } : undefined)
    ));

    return NextResponse.json({
      ok: true,
      view,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
