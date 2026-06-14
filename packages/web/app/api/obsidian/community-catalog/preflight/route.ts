export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { preflightObsidianCommunityPluginPackage } from '@/lib/obsidian-compat/community-catalog';

export async function GET(req: NextRequest) {
  try {
    const repo = req.nextUrl.searchParams.get('repo')?.trim();
    if (!repo) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing repo');
    }

    const pluginId = req.nextUrl.searchParams.get('pluginId')?.trim() || undefined;
    const preflight = await preflightObsidianCommunityPluginPackage({
      repo,
      pluginId,
    });

    return NextResponse.json(preflight);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
