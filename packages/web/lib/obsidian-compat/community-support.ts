import {
  getObsidianImportSupport,
  type ObsidianImportSupportKind,
} from './import-policy';
import type { CompatibilityLevel, PluginCompatibilityReport } from './compatibility-report';

export type ObsidianCommunityPreflightSupportLevel = ObsidianImportSupportKind | 'native';
export type ObsidianCommunitySurfacePreviewId =
  | 'commands'
  | 'settings'
  | 'entries'
  | 'views'
  | 'document'
  | 'styles'
  | 'editor'
  | 'vault'
  | 'network';
export type ObsidianCommunitySurfacePreviewState = 'mounted' | 'limited' | 'catalog' | 'blocked';

export interface ObsidianCommunityPreflightSupport {
  kind: ObsidianCommunityPreflightSupportLevel;
  label: string;
  reason: string;
  installable: boolean;
}

export interface ObsidianCommunitySurfacePreview {
  id: ObsidianCommunitySurfacePreviewId;
  state: ObsidianCommunitySurfacePreviewState;
  count: number;
}

export interface ObsidianCommunitySupportInput {
  compatibility: {
    level: CompatibilityLevel;
    report: PluginCompatibilityReport;
  };
  installable: boolean;
  installBlockedReasons?: string[];
  stylesCss: boolean;
}

interface CommunitySurfacePreviewDefinition {
  id: ObsidianCommunitySurfacePreviewId;
  state: ObsidianCommunitySurfacePreviewState;
  apiNames?: string[];
  countFrom?: (apiNames: Set<string>, input: ObsidianCommunitySupportInput) => number;
}

const COMMUNITY_SURFACE_PREVIEW_DEFINITIONS: CommunitySurfacePreviewDefinition[] = [
  {
    id: 'commands',
    state: 'mounted',
    apiNames: ['addCommand', 'removeCommand'],
  },
  {
    id: 'settings',
    state: 'mounted',
    apiNames: ['PluginSettingTab', 'Setting', 'addSettingTab'],
  },
  {
    id: 'entries',
    state: 'mounted',
    apiNames: [
      'addRibbonIcon',
      'addStatusBarItem',
      'Notice',
      'Modal',
      'Menu',
      'MenuItem',
      'SuggestModal',
      'FuzzySuggestModal',
    ],
  },
  {
    id: 'views',
    state: 'limited',
    apiNames: [
      'registerView',
      'registerExtensions',
      'ItemView',
      'WorkspaceLeaf',
      'Workspace.getLeaf',
      'Workspace.getLeavesOfType',
    ],
  },
  {
    id: 'document',
    state: 'limited',
    apiNames: [
      'registerMarkdownPostProcessor',
      'registerMarkdownCodeBlockProcessor',
      'MarkdownRenderer',
      'MarkdownView',
      'MarkdownRenderChild',
    ],
  },
  {
    id: 'styles',
    state: 'mounted',
    countFrom: (_apiNames, input) => input.stylesCss ? 1 : 0,
  },
  {
    id: 'editor',
    state: 'catalog',
    apiNames: ['registerEditorExtension'],
  },
  {
    id: 'vault',
    state: 'mounted',
    countFrom: countVaultLikeApis,
  },
  {
    id: 'network',
    state: 'limited',
    apiNames: ['request', 'requestUrl'],
  },
];

export function buildObsidianCommunityPreflightSupport(
  input: ObsidianCommunitySupportInput,
): ObsidianCommunityPreflightSupport {
  if (!input.installable) {
    const nativeReason = nativeRuntimeReason(input);
    if (nativeReason) {
      return {
        kind: 'native',
        label: 'Needs native runtime',
        reason: nativeReason,
        installable: false,
      };
    }

    return {
      kind: 'blocked',
      label: 'Blocked',
      reason: input.installBlockedReasons?.[0]
        ?? input.compatibility.report.blockers[0]
        ?? 'Blocked by preflight compatibility checks.',
      installable: false,
    };
  }

  if (input.compatibility.report.platformRequirements?.desktop) {
    return {
      kind: 'review',
      label: 'Desktop runtime',
      reason: 'This plugin declares a desktop-only requirement. MindOS found no hard native blocker, but verify it in the local Desktop runtime after install.',
      installable: true,
    };
  }

  if ((input.compatibility.report.supportedModules?.length ?? 0) > 0) {
    return {
      kind: 'limited',
      label: 'Limited',
      reason: `Supported native-compatible modules are available through the MindOS runtime: ${input.compatibility.report.supportedModules?.slice(0, 4).join(', ')}`,
      installable: true,
    };
  }

  const support = getObsidianImportSupport({
    compatibilityLevel: input.compatibility.level,
    compatibility: {
      partialApis: input.compatibility.report.partialApis,
      unsupportedApis: input.compatibility.report.unsupportedApis,
      blockers: input.compatibility.report.blockers,
    },
  });

  return {
    kind: support.kind,
    label: support.label,
    reason: support.reason,
    installable: input.installable,
  };
}

export function buildObsidianCommunitySurfacePreview(
  input: ObsidianCommunitySupportInput,
): ObsidianCommunitySurfacePreview[] {
  const apiNames = collectApiNames(input.compatibility.report);
  const nativeBlocked = Boolean(nativeRuntimeReason(input));
  const blocked = (!input.installable || input.compatibility.level === 'blocked') && !nativeBlocked;

  return COMMUNITY_SURFACE_PREVIEW_DEFINITIONS
    .map((definition) => {
      const count = definition.countFrom
        ? definition.countFrom(apiNames, input)
        : countMatchingApis(apiNames, definition.apiNames ?? []);
      if (count <= 0) return null;
      return {
        id: definition.id,
        state: blocked ? 'blocked' as const : definition.state,
        count,
      };
    })
    .filter((prediction): prediction is ObsidianCommunitySurfacePreview => prediction !== null);
}

function nativeRuntimeReason(input: ObsidianCommunitySupportInput): string | null {
  const installBlockedReasons = input.installBlockedReasons ?? [];
  const unsupportedNativeModules = new Set(
    input.compatibility.report.unsupportedModules.filter((moduleName) => input.compatibility.report.nodeModules.includes(moduleName)),
  );
  const nativeBlockReasons = installBlockedReasons.filter((reason) => {
    const match = reason.match(/^Requires unsupported runtime module: (.+)$/);
    return Boolean(match?.[1] && unsupportedNativeModules.has(match[1]));
  });

  if (nativeBlockReasons.length === 0) return null;
  if (nativeBlockReasons.length !== installBlockedReasons.length) return null;

  const modules = Array.from(unsupportedNativeModules).slice(0, 4).join(', ');
  return `Requires native Desktop capabilities that are not yet exposed to community plugins: ${modules}.`;
}

function collectApiNames(report: PluginCompatibilityReport): Set<string> {
  return new Set([
    ...report.obsidianApis,
    ...report.supportedApis,
    ...report.partialApis,
    ...(report.unsupportedApis ?? []),
  ]);
}

function countMatchingApis(apiNames: Set<string>, names: string[]): number {
  return names.filter((name) => apiNames.has(name)).length;
}

function countVaultLikeApis(apiNames: Set<string>): number {
  let count = 0;
  for (const name of apiNames) {
    if (
      name === 'loadData'
      || name === 'saveData'
      || name === 'TFile'
      || name === 'TFolder'
      || name === 'TAbstractFile'
      || name.startsWith('Vault.')
      || name.startsWith('FileManager.')
      || name.startsWith('MetadataCache.')
    ) {
      count += 1;
    }
  }
  return count;
}
