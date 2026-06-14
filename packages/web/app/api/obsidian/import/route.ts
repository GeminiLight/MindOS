export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { importObsidianPlugin, scanObsidianVaultPlugins } from '@/lib/obsidian-compat/obsidian-import';
import { getObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import { expandSetupPathHome } from '@/app/api/setup/path-utils';
import { readSettings } from '@/lib/settings';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { vaultRoot?: string; pluginId?: string };
    if (!body.vaultRoot || !body.pluginId) {
      return NextResponse.json({ ok: false, error: 'Missing vaultRoot or pluginId' }, { status: 400 });
    }

    const vaultRoot = expandSetupPathHome(body.vaultRoot.trim());
    const settings = readSettings();
    const result = await scanObsidianVaultPlugins(vaultRoot);
    const plugin = result.plugins.find((item) => item.id === body.pluginId);
    if (!plugin) {
      return NextResponse.json({ ok: false, error: 'Plugin not found in Obsidian vault' }, { status: 404 });
    }
    const support = getObsidianImportSupport(plugin);
    if (!support.importable) {
      return NextResponse.json({ ok: false, error: support.reason }, { status: 409 });
    }

    const imported = await importObsidianPlugin({
      vaultRoot,
      pluginId: body.pluginId,
      targetMindRoot: settings.mindRoot,
    });

    return NextResponse.json({
      ok: true,
      plugin: {
        ...plugin,
        importable: support.importable,
      },
      imported,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
