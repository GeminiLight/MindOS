import type { CompatibilityLevel } from './compatibility-report';

export type ObsidianImportSupportKind = 'ready' | 'limited' | 'review' | 'blocked';

export interface ObsidianImportPolicyPlugin {
  compatibilityLevel: CompatibilityLevel;
  compatibility: {
    partialApis: string[];
    unsupportedApis?: string[];
    blockers: string[];
  };
  obsidianConfig?: {
    enabledInObsidian?: boolean;
  };
}

export interface ObsidianImportSupport {
  kind: ObsidianImportSupportKind;
  importable: boolean;
  defaultSelected: boolean;
  label: string;
  summaryLabel: string;
  reason: string;
}

function unsupportedApis(plugin: ObsidianImportPolicyPlugin): string[] {
  return plugin.compatibility.unsupportedApis ?? [];
}

export function getObsidianImportSupport(
  plugin: ObsidianImportPolicyPlugin,
  options: { hasEnabledList?: boolean } = {},
): ObsidianImportSupport {
  const hasSourceEnabledList = options.hasEnabledList === true;
  const enabledInObsidian = plugin.obsidianConfig?.enabledInObsidian === true;
  const sourceAllowsDefault = !hasSourceEnabledList || enabledInObsidian;

  if (plugin.compatibilityLevel === 'blocked') {
    return {
      kind: 'blocked',
      importable: false,
      defaultSelected: false,
      label: 'Blocked',
      summaryLabel: 'blocked',
      reason: plugin.compatibility.blockers[0] ?? 'Blocked by compatibility checks.',
    };
  }

  if (plugin.compatibilityLevel === 'compatible') {
    return {
      kind: 'ready',
      importable: true,
      defaultSelected: sourceAllowsDefault,
      label: 'Ready',
      summaryLabel: 'ready',
      reason: 'Supported APIs can load through the MindOS Obsidian compatibility host.',
    };
  }

  if (unsupportedApis(plugin).length > 0) {
    return {
      kind: 'review',
      importable: true,
      defaultSelected: false,
      label: 'Review',
      summaryLabel: 'review',
      reason: `Unsupported APIs need manual review: ${unsupportedApis(plugin).slice(0, 4).join(', ')}`,
    };
  }

  return {
    kind: 'limited',
    importable: true,
    defaultSelected: sourceAllowsDefault,
    label: 'Limited',
    summaryLabel: 'limited',
    reason: plugin.compatibility.partialApis.length > 0
      ? `Limited APIs are routed through safe MindOS hosts: ${plugin.compatibility.partialApis.slice(0, 4).join(', ')}`
      : 'No blockers were detected, but this plugin should be reviewed after import.',
  };
}

export function isObsidianPluginImportable(plugin: ObsidianImportPolicyPlugin): boolean {
  return getObsidianImportSupport(plugin).importable;
}
