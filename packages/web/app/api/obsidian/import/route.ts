export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { importObsidianPlugin, normalizeObsidianConfigDir, scanObsidianVaultPlugins } from '@/lib/obsidian-compat/obsidian-import';
import { getObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import { buildObsidianCapabilityCoverage, summarizeObsidianCapabilityCoverage } from '@/lib/obsidian-compat/capability-matrix';
import { buildObsidianCommunitySurfacePreview } from '@/lib/obsidian-compat/community-support';
import { buildObsidianCompatibilityPreview } from '@/lib/obsidian-compat/compatibility-preview';
import { OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH } from '@/lib/obsidian-compat/plugin-paths';
import { expandSetupPathHome } from '@/app/api/setup/path-utils';
import { readSettings } from '@/lib/settings';

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'Missing vaultRoot or pluginId' }, { status: 400 });
    }
    const {
      vaultRoot: rawVaultRoot,
      pluginId: rawPluginId,
      configDir: rawConfigDir,
      obsidianConfigDir: rawObsidianConfigDir,
    } = body as { vaultRoot?: unknown; pluginId?: unknown; configDir?: unknown; obsidianConfigDir?: unknown };
    if (typeof rawVaultRoot !== 'string' || typeof rawPluginId !== 'string' || !rawVaultRoot.trim() || !rawPluginId.trim()) {
      return NextResponse.json({ ok: false, error: 'Missing vaultRoot or pluginId' }, { status: 400 });
    }
    if (rawConfigDir !== undefined && typeof rawConfigDir !== 'string') {
      return NextResponse.json({ ok: false, error: 'Invalid Obsidian config folder' }, { status: 400 });
    }
    if (rawObsidianConfigDir !== undefined && typeof rawObsidianConfigDir !== 'string') {
      return NextResponse.json({ ok: false, error: 'Invalid Obsidian config folder' }, { status: 400 });
    }

    const pluginId = rawPluginId.trim();
    const vaultRoot = expandSetupPathHome(rawVaultRoot.trim());
    let configDir: string;
    try {
      configDir = normalizeObsidianConfigDir(rawConfigDir ?? rawObsidianConfigDir);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid Obsidian config folder' }, { status: 400 });
    }
    const settings = readSettings();
    const result = await scanObsidianVaultPlugins(vaultRoot, { configDir });
    const plugin = result.plugins.find((item) => item.id === pluginId);
    if (!plugin) {
      return NextResponse.json({ ok: false, error: 'Plugin not found in Obsidian vault' }, { status: 404 });
    }
    const support = getObsidianImportSupport(plugin, { hasEnabledList: result.vault.hasEnabledList });
    if (!support.importable) {
      return NextResponse.json({ ok: false, error: support.reason }, { status: 409 });
    }

    const imported = await importObsidianPlugin({
      vaultRoot,
      pluginId,
      targetMindRoot: settings.mindRoot,
      configDir,
    });
    const coverage = buildObsidianCapabilityCoverage(plugin.compatibility);
    const compatibilityPreview = buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath: result.vault.pluginsRelativePath,
      hasEnabledList: result.vault.hasEnabledList,
      support,
      coverage,
    });
    const { sourceDir: _sourceDir, ...publicPlugin } = plugin;
    const { targetDir: _targetDir, ...publicImported } = imported;

    return NextResponse.json({
      ok: true,
      plugin: {
        ...publicPlugin,
        importable: support.importable,
        support,
        coverage,
        coverageSummary: summarizeObsidianCapabilityCoverage(coverage),
        surfacePreview: buildObsidianCommunitySurfacePreview({
          compatibility: {
            level: plugin.compatibilityLevel,
            report: plugin.compatibility,
          },
          installable: support.importable,
          stylesCss: plugin.hasStyles,
        }),
        compatibilityPreview,
      },
      compatibilityPreview,
      imported: {
        ...publicImported,
        targetPath: `${OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH}/${imported.pluginId}`,
        sourceConfigDir: imported.obsidianConfig.sourceConfigDir,
      },
      nextStep: {
        manageHref: '/settings?tab=plugins',
        surfacesHref: '/settings?tab=plugins&panel=surfaces',
        message: 'Imported locally. Enable and load it from Installed before it can run.',
      },
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
