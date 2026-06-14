export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { planObsidianCommunityPluginUpdate } from '@/lib/obsidian-compat/community-install';

export async function GET(req: NextRequest) {
  try {
    const repo = req.nextUrl.searchParams.get('repo')?.trim();
    const pluginId = req.nextUrl.searchParams.get('pluginId')?.trim();

    if (!repo || !pluginId) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing repo or pluginId');
    }

    const settings = readSettings();
    const result = await planObsidianCommunityPluginUpdate({
      repo,
      pluginId,
      targetMindRoot: settings.mindRoot,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
