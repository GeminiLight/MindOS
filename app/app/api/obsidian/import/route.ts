export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { importObsidianPlugin, scanObsidianVaultPlugins } from '@/lib/obsidian-compat/obsidian-import';
import { expandSetupPathHome } from '@/app/api/setup/path-utils';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { vaultRoot?: string; pluginId?: string; targetMindRoot?: string };
    if (!body.vaultRoot || !body.pluginId || !body.targetMindRoot) {
      return NextResponse.json({ ok: false, error: 'Missing vaultRoot, pluginId, or targetMindRoot' }, { status: 400 });
    }

    const vaultRoot = expandSetupPathHome(body.vaultRoot.trim());
    const targetMindRoot = expandSetupPathHome(body.targetMindRoot.trim());
    const result = await scanObsidianVaultPlugins(vaultRoot);
    const plugin = result.plugins.find((item) => item.id === body.pluginId);
    if (!plugin) {
      return NextResponse.json({ ok: false, error: 'Plugin not found in Obsidian vault' }, { status: 404 });
    }

    const imported = await importObsidianPlugin({
      vaultRoot,
      pluginId: body.pluginId,
      targetMindRoot,
    });

    return NextResponse.json({
      ok: true,
      plugin,
      imported,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
