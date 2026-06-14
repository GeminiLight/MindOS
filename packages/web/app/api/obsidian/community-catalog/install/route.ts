export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { installObsidianCommunityPlugin } from '@/lib/obsidian-compat/community-install';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { repo?: string; pluginId?: string; confirm?: boolean };
    const repo = body.repo?.trim();
    const pluginId = body.pluginId?.trim();

    if (!repo || !pluginId) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing repo or pluginId');
    }

    const settings = readSettings();
    const result = await installObsidianCommunityPlugin({
      repo,
      pluginId,
      targetMindRoot: settings.mindRoot,
      confirm: body.confirm === true,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
