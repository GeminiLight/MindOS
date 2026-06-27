export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';
import { Vault } from '@/lib/obsidian-compat/shims/vault';
import { MetadataCacheShim } from '@/lib/obsidian-compat/shims/metadata-cache';
import { buildObsidianNativeQueryIndex } from '@/lib/obsidian-compat/native-query-index';
import {
  buildObsidianNativeQueryPreview,
  hasObsidianNativeQueryPreview,
} from '@/lib/obsidian-compat/native-query-preview';

function requirePluginId(req: NextRequest): string {
  const pluginId = req.nextUrl.searchParams.get('pluginId')?.trim();
  if (!pluginId) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing pluginId for native query preview');
  }
  return pluginId;
}

export async function GET(req: NextRequest) {
  try {
    const pluginId = requirePluginId(req);
    const settings = readSettings();

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const plugin = manager.list().find((item) => item.id.toLowerCase() === pluginId.toLowerCase());
      if (!plugin) {
        throw new MindOSError(ErrorCodes.FILE_NOT_FOUND, `Unknown Obsidian plugin: ${pluginId}`);
      }
      if (!hasObsidianNativeQueryPreview(plugin)) {
        throw new MindOSError(
          ErrorCodes.INVALID_REQUEST,
          `Native query preview is not available for ${plugin.name}.`,
        );
      }

      const vault = new Vault(settings.mindRoot);
      const metadataCache = new MetadataCacheShim(settings.mindRoot, vault);
      const index = await buildObsidianNativeQueryIndex({ vault, metadataCache });

      return NextResponse.json(buildObsidianNativeQueryPreview(plugin.id, index));
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
