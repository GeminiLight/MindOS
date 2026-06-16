export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { updateObsidianCommunityPlugin } from '@/lib/obsidian-compat/community-install';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      repo?: string;
      pluginId?: string;
      confirm?: boolean;
      expectedRemoteVersion?: string;
      expectedPackageDigest?: string;
      appVersion?: string;
    };
    const repo = body.repo?.trim();
    const pluginId = body.pluginId?.trim();
    const expectedRemoteVersion = body.expectedRemoteVersion?.trim();
    const expectedPackageDigest = body.expectedPackageDigest?.trim();
    const targetAppVersion = body.appVersion?.trim() || undefined;

    if (!repo || !pluginId) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing repo or pluginId');
    }
    if (body.confirm !== true) {
      throw new MindOSError(
        ErrorCodes.INVALID_REQUEST,
        'Community plugin update requires explicit confirmation.',
      );
    }
    if (!expectedRemoteVersion || !expectedPackageDigest) {
      throw new MindOSError(
        ErrorCodes.INVALID_REQUEST,
        'Community plugin update requires a fresh preview version and package digest.',
      );
    }

    const settings = readSettings();
    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const result = await updateObsidianCommunityPlugin({
        repo,
        pluginId,
        targetAppVersion,
        targetMindRoot: settings.mindRoot,
        confirm: true,
        expectedRemoteVersion,
        expectedPackageDigest,
        beforeSwap: () => manager.prepareForPackageUpdate(pluginId),
      });
      await manager.discover();

      return NextResponse.json({
        ...result,
        plugins: manager.list(),
      });
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
