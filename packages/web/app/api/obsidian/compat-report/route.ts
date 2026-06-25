export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  normalizeObsidianConfigDir,
  scanObsidianVaultPlugins,
  type ScannedObsidianPlugin,
} from '@/lib/obsidian-compat/obsidian-import';
import {
  getObsidianImportSupport,
  type ObsidianImportSupportKind,
} from '@/lib/obsidian-compat/import-policy';
import {
  buildObsidianCapabilityCoverage,
  summarizeObsidianCapabilityCoverage,
  summarizeObsidianCapabilitySurfaces,
} from '@/lib/obsidian-compat/capability-matrix';
import { buildObsidianCommunitySurfacePreview } from '@/lib/obsidian-compat/community-support';
import { OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH } from '@/lib/obsidian-compat/plugin-paths';
import { buildObsidianCompatibilityPreview } from '@/lib/obsidian-compat/compatibility-preview';
import { expandSetupPathHome } from '@/app/api/setup/path-utils';

function enrichPlugin(plugin: ScannedObsidianPlugin, hasEnabledList: boolean, sourcePluginsPath: string) {
  const support = getObsidianImportSupport(plugin, { hasEnabledList });
  const coverage = buildObsidianCapabilityCoverage(plugin.compatibility);
  const surfacePreview = buildObsidianCommunitySurfacePreview({
    compatibility: {
      level: plugin.compatibilityLevel,
      report: plugin.compatibility,
    },
    installable: support.importable,
    installBlockedReasons: support.importable ? [] : [support.reason],
    stylesCss: plugin.hasStyles,
  });
  const { sourceDir: _sourceDir, ...rest } = plugin;
  return {
    ...rest,
    importable: support.importable,
    support,
    coverage,
    coverageSummary: summarizeObsidianCapabilityCoverage(coverage),
    surfaceSummary: summarizeObsidianCapabilitySurfaces(coverage),
    surfacePreview,
    compatibilityPreview: buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath,
      hasEnabledList,
      support,
      coverage,
    }),
    migrationPlan: {
      copiedFiles: [
        'manifest.json',
        'main.js',
        ...(plugin.hasStyles ? ['styles.css'] : []),
        ...(plugin.hasData ? ['data.json'] : []),
        'obsidian-import.json',
      ],
      sourceVaultUnchanged: true,
      enableAfterImport: false,
      defaultSelected: support.defaultSelected,
    },
  };
}

function sanitizeSkippedReason(reason: string, vaultRoot: string): string {
  return reason
    .split(vaultRoot).join('<vault>')
    .split(vaultRoot.replace(/\\/g, '/')).join('<vault>');
}

export async function GET(req: NextRequest) {
  try {
    const vaultRootParam = req.nextUrl.searchParams.get('vaultRoot');
    if (!vaultRootParam) {
      return NextResponse.json({ ok: false, error: 'Missing vaultRoot' }, { status: 400 });
    }

    const vaultRoot = expandSetupPathHome(vaultRootParam.trim());
    const rawConfigDir = req.nextUrl.searchParams.get('configDir') ?? req.nextUrl.searchParams.get('obsidianConfigDir') ?? undefined;
    let configDir: string;
    try {
      configDir = normalizeObsidianConfigDir(rawConfigDir ?? undefined);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid Obsidian config folder' }, { status: 400 });
    }
    const result = await scanObsidianVaultPlugins(vaultRoot, { configDir });
    const hasEnabledList = result.vault.hasEnabledList;
    const plugins = result.plugins.map((plugin) => enrichPlugin(plugin, hasEnabledList, result.vault.pluginsRelativePath));
    const supportCounts = plugins.reduce<Record<ObsidianImportSupportKind, number>>((counts, plugin) => {
      counts[plugin.support.kind] += 1;
      return counts;
    }, { ready: 0, limited: 0, review: 0, blocked: 0 });
    const selectedByDefault = plugins.filter((plugin) => plugin.support.defaultSelected).length;
    const enabledInObsidian = plugins.filter((plugin) => plugin.obsidianConfig.enabledInObsidian).length;
    const hotkeys = plugins.reduce((sum, plugin) => sum + plugin.obsidianConfig.hotkeyCount, 0);
    const summary = {
      total: result.plugins.length,
      compatible: result.plugins.filter((plugin) => plugin.compatibilityLevel === 'compatible').length,
      partial: result.plugins.filter((plugin) => plugin.compatibilityLevel === 'partial').length,
      blocked: result.plugins.filter((plugin) => plugin.compatibilityLevel === 'blocked').length,
      importable: plugins.filter((plugin) => plugin.support.importable).length,
      support: supportCounts,
      selectedByDefault,
      enabledInObsidian,
      hotkeys,
      hasEnabledList,
      pluginsDirFound: result.vault.pluginsDirFound,
    };

    return NextResponse.json({
      ok: true,
      vaultRoot,
      configDir: result.vault.configDir,
      sourcePluginsPath: result.vault.pluginsRelativePath,
      summary,
      migration: {
        defaultSelectionPolicy: hasEnabledList
          ? 'Source-enabled plugins that are ready or limited are selected by default. Review and blocked plugins stay unchecked.'
          : 'Ready and limited plugins are selected by default because this vault has no enabled plugin list. Review and blocked plugins stay unchecked.',
        sourceVaultUnchanged: true,
        sourcePluginsPath: result.vault.pluginsRelativePath,
        writesTo: `${OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH}/<plugin-id>`,
        writesConfig: 'obsidian-import.json',
        enableAfterImport: false,
      },
      plugins,
      skipped: result.skipped.map((item) => ({
        ...item,
        reason: sanitizeSkippedReason(item.reason, vaultRoot),
      })),
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
