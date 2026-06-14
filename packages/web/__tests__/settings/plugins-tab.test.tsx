// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PluginsTab } from '@/components/settings/PluginsTab';
import { OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY } from '@/lib/plugins/client';

const mocks = vi.hoisted(() => ({
  getPluginRenderers: vi.fn(),
  isRendererEnabled: vi.fn(),
  loadDisabledState: vi.fn(),
  setRendererEnabled: vi.fn(),
  apiFetch: vi.fn(),
  openEntries: vi.fn(),
  openCommandCenter: vi.fn(),
  openViews: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('@/lib/renderers/registry', () => ({
  getPluginRenderers: mocks.getPluginRenderers,
  isRendererEnabled: mocks.isRendererEnabled,
  loadDisabledState: mocks.loadDisabledState,
  setRendererEnabled: mocks.setRendererEnabled,
}));

vi.mock('@/components/settings/ObsidianImportSection', () => ({
  ObsidianImportSection: ({ initialExpanded }: { initialExpanded?: boolean }) => (
    <div data-testid="obsidian-import">
      import:{String(initialExpanded)}
    </div>
  ),
}));

vi.mock('@/components/settings/ObsidianPluginHostSection', () => ({
  ObsidianPluginHostSection: ({ focusPluginId }: { focusPluginId?: string | null }) => (
    <div data-testid="obsidian-host">Obsidian plugin host focus:{focusPluginId ?? 'none'}</div>
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = {
  settings: {
    plugins: {
      title: 'Plugins',
      managerTitle: 'Plugin Manager',
      managerSubtitle: 'Manage plugin layers.',
      sectionNavLabel: 'Plugin manager sections',
      installedTab: 'Installed',
      communityTab: 'Community',
      importTab: 'Import',
      surfacesTab: 'Surfaces',
      pluginsMetric: 'plugins',
      obsidianMetric: 'Obsidian',
      surfacesMetric: 'surfaces',
      renderersMetric: 'renderers',
      coreMetric: 'core',
      enabledMetric: 'enabled',
      optionalMetric: 'optional',
      catalogInventoryTitle: 'Plugin inventory',
      catalogInventoryDesc: 'Inventory description',
      catalogAllFilter: 'All',
      catalogAllFilterDesc: 'All packages',
      catalogMindosFilter: 'MindOS',
      catalogMindosFilterDesc: 'MindOS packages',
      catalogObsidianFilter: 'Obsidian',
      catalogObsidianFilterDesc: 'Obsidian packages',
      catalogDisabledFilter: 'Disabled',
      catalogDisabledFilterDesc: 'Disabled packages',
      catalogProblemFilter: 'Problem',
      catalogProblemFilterDesc: 'Problem packages',
      catalogProblemMetric: (n: number) => `${n} problems`,
      catalogFilteredTitle: (label: string) => `${label} inventory`,
      catalogFilteredDesc: 'Filtered inventory',
      catalogNoMatches: 'No matches',
      catalogSourceMindos: 'MindOS',
      catalogSourceObsidian: 'Obsidian',
      catalogStatus: (status: string) => status,
      mindosRenderersTitle: 'MindOS renderers',
      mindosRenderersDesc: 'Renderer description',
      surfacesTitle: 'Plugin surfaces',
      surfacesDesc: 'Surfaces description',
      surfaceInventoryTitle: 'Live surface inventory',
      surfaceInventoryDesc: 'Live inventory description',
      surfaceInventoryRefresh: 'Refresh',
      surfaceInventoryLoading: 'Loading surfaces',
      surfaceInventoryLoadFailed: 'Could not load plugin surfaces',
      surfaceInventoryEmpty: 'No plugin surfaces',
      surfaceInventoryByKindTitle: 'Surface types',
      surfaceInventoryTotalMetric: 'Total',
      surfaceInventoryMountedMetric: 'Mounted',
      surfaceInventoryCatalogMetric: 'Catalog',
      surfaceInventoryRecordedMetric: 'Recorded',
      surfaceInventoryBlockedMetric: 'Blocked',
      surfaceInventoryKindSummary: (total: number, mounted: number, catalog: number, recorded: number) => `${total} total ${mounted} mounted ${catalog} catalog ${recorded} recorded`,
      hotkeyBindingTitle: 'Obsidian hotkeys',
      hotkeyBindingDesc: 'Bind safe hotkeys',
      hotkeyBindingEnabled: 'Enabled',
      hotkeyBindingDisabled: 'Off',
      hotkeyBindingBindableMetric: 'Bindable',
      hotkeyBindingTotalMetric: 'Total',
      hotkeyBindingBlockedMetric: 'Blocked',
      editorGateTitle: 'Browser editor gate',
      editorGateDesc: 'Editor gate description',
      editorGateStatus: 'Gate required',
      editorGateCatalogMetric: 'Catalog-only',
      editorGateExtensionsMetric: 'Extensions',
      editorGatePluginsMetric: 'Plugins',
      editorGateSerializableMetric: 'Serializable',
      surfaceKindLabel: (kind: string) => ({
        command: 'Commands',
        ribbon: 'Ribbon actions',
        view: 'Plugin views',
        markdown: 'Markdown hooks',
        style: 'Stylesheets',
        editor: 'Editor extensions',
        'document-renderer': 'Document renderers',
      }[kind] ?? kind),
      commandCenterTitle: 'Command Center',
      commandCenterDesc: 'Commands live here',
      pluginEntriesTitle: 'Plugin Entries',
      pluginEntriesDesc: 'Entries live here',
      pluginViewsTitle: 'Plugin Views',
      pluginViewsDesc: 'Views live here',
      communityTitle: 'Obsidian Community',
      communityDesc: 'Browse official plugins',
      communityReadOnlyBadge: 'gated install',
      communitySearchPlaceholder: 'Search community plugins',
      communitySearchAction: 'Search',
      communityRefreshAction: 'Refresh',
      communityTotalMetric: 'catalog',
      communityReturnedMetric: 'shown',
      communityInstalledMetric: 'local',
      communityProblemMetric: 'issues',
      communityLoadFailed: 'Could not load community catalog',
      communitySkippedNotice: (n: number) => `${n} skipped`,
      communityOfficialSource: 'Official Obsidian index',
      communityDefaultQueryLabel: 'Default community list',
      communityQueryLabel: (query: string) => `Search: ${query}`,
      communityLoading: 'Loading catalog',
      communityNoResults: 'No community plugins',
      communityInstallStatus: (status: string) => status,
      communityGithubAction: 'GitHub',
      communityImportAction: 'Import local',
      communityManageAction: 'Manage',
      communityImportHint: 'Run Check before installing.',
      communityInstallAction: 'Install',
      communityInstallInstalling: 'Installing',
      communityInstallConfirm: (name: string) => `Install ${name}?`,
      communityInstallFailed: 'Could not install package',
      communityInstallSucceeded: (version: string) => `Installed ${version}`,
      communityPreflightAction: 'Check',
      communityPreflightChecking: 'Checking',
      communityPreflightFailed: 'Could not preflight package',
      communityPreflightNoBlockers: 'No blockers',
      communityPreflightStatus: (level: string, installable: boolean) => (installable ? 'Preflight passed' : `Preflight ${level}`),
      communityPreflightAssets: (version: string, stylesCss: boolean) => `manifest ${version} · styles ${stylesCss ? 'found' : 'none'}`,
      communityUpdateCheckAction: 'Check update',
      communityUpdateStatus: (state: string) => ({
        'update-available': 'Update available',
        'up-to-date': 'Up to date',
        'local-newer': 'Local version is newer',
        unknown: 'Version needs review',
      }[state] ?? 'Version needs review'),
      communityUpdateVersions: (installedVersion?: string, remoteVersion?: string) => `local ${installedVersion ?? 'unknown'} · remote ${remoteVersion ?? 'unknown'}`,
      communityUpdateNote: (state: string) => ({
        'update-available': 'Remote package is newer. No remote reset.',
        'up-to-date': 'The installed local copy matches remote.',
        'local-newer': 'The installed local copy is newer.',
        unknown: 'Review versions manually.',
      }[state] ?? 'Review versions manually.'),
      communityUpdatePreviewAction: 'Preview plan',
      communityUpdatePreviewLoading: 'Building preview',
      communityUpdatePreviewFailed: 'Could not preview update plan',
      communityUpdatePreviewTitle: 'Read-only update plan',
      communityUpdatePreviewPolicy: 'Preview only. No files changed.',
      communityUpdatePreviewBlocked: (reason?: string) => `Preview blocked${reason ? `: ${reason}` : ''}`,
      communityUpdatePreviewFile: (action: string, localBytes?: number, remoteBytes?: number) => `${action} ${localBytes ?? '-'}>${remoteBytes ?? '-'}`,
      communityUpdateApplyAction: 'Apply update',
      communityUpdateApplyLoading: 'Applying',
      communityUpdateApplyFailed: 'Could not apply update',
      communityUpdateApplySucceeded: (version: string) => `Updated locally ${version}`,
      communityUpdateApplyConfirm: (name: string, version: string) => `Apply ${name} ${version}?`,
      marketplaceTitle: 'Community marketplace',
      openAction: 'Open',
      unavailableAction: 'Soon',
      surfaceCountBadge: (n: number) => `${n} surface${n === 1 ? '' : 's'}`,
      builtinBadge: 'built-in',
      coreBadge: 'core',
      enabled: 'Enabled',
      disabled: 'Disabled',
      matchHint: 'Auto-activates on',
      coreHint: 'Core renderer - always enabled',
      noPlugins: 'No renderers installed.',
      comingSoon: 'Plugin marketplace coming soon.',
    },
  },
} as any;

async function renderTab() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <PluginsTab
        pluginStates={{ daily: true }}
        setPluginStates={vi.fn()}
        t={t}
        mindRoot="/tmp/mind"
        onOpenPluginEntries={mocks.openEntries}
        onOpenCommandCenter={mocks.openCommandCenter}
        onOpenPluginViews={mocks.openViews}
      />,
    );
    await Promise.resolve();
  });

  return { host, root };
}

async function cleanup(root: Root, host: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  host.remove();
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PluginsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getPluginRenderers.mockReturnValue([
      {
        id: 'markdown',
        name: 'Markdown',
        description: 'Default note renderer',
        author: 'MindOS',
        icon: 'M',
        tags: ['notes'],
        builtin: true,
        core: true,
        match: () => true,
      },
      {
        id: 'daily',
        name: 'Daily notes',
        description: 'Calendar-oriented renderer',
        author: 'MindOS',
        icon: 'D',
        tags: ['journal'],
        builtin: true,
        match: ({ filePath }: { filePath: string }) => /Daily/.test(filePath),
      },
    ]);
    mocks.isRendererEnabled.mockImplementation((id: string) => id !== 'disabled');
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/obsidian/community-catalog/install') {
        return {
          ok: true,
          plugin: {
            id: 'quickadd',
            name: 'QuickAdd',
            repo: 'chhoumann/quickadd',
            githubUrl: 'https://github.com/chhoumann/quickadd',
          },
          installed: {
            pluginId: 'quickadd',
            targetDir: '/tmp/mind/.plugins/quickadd',
            enabled: false,
            loaded: false,
            source: 'obsidian-community',
          },
          preflight: {
            ok: true,
            plugin: {
              id: 'quickadd',
              name: 'QuickAdd',
              repo: 'chhoumann/quickadd',
              githubUrl: 'https://github.com/chhoumann/quickadd',
            },
            package: {
              manifest: {
                id: 'quickadd',
                name: 'QuickAdd',
                version: '1.0.0',
              },
              assets: {
                manifestJson: true,
                mainJs: true,
                stylesCss: false,
              },
              source: {
                manifestUrl: 'https://raw.githubusercontent.com/chhoumann/quickadd/HEAD/manifest.json',
                mainUrl: 'https://raw.githubusercontent.com/chhoumann/quickadd/HEAD/main.js',
                stylesUrl: 'https://raw.githubusercontent.com/chhoumann/quickadd/HEAD/styles.css',
              },
            },
            compatibility: {
              level: 'compatible',
              report: {
                obsidianApis: ['Plugin'],
                moduleImports: [],
                nodeModules: [],
                unsupportedModules: [],
                supportedApis: ['Plugin'],
                partialApis: [],
                unsupportedApis: [],
                blockers: [],
              },
            },
            installable: true,
            installBlockedReasons: [],
          },
        };
      }

      if (url.startsWith('/api/obsidian/community-catalog/preflight')) {
        const requestUrl = new URL(url, 'http://localhost');
        const pluginId = requestUrl.searchParams.get('pluginId') ?? 'quickadd';
        const fixtures = {
          dataview: {
            id: 'dataview',
            name: 'Dataview',
            repo: 'blacksmithgu/obsidian-dataview',
            githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
            version: '0.5.1',
            stylesCss: true,
          },
          quickadd: {
            id: 'quickadd',
            name: 'QuickAdd',
            repo: 'chhoumann/quickadd',
            githubUrl: 'https://github.com/chhoumann/quickadd',
            version: '1.0.0',
            stylesCss: false,
          },
          'desktop-only': {
            id: 'desktop-only',
            name: 'Desktop Only',
            repo: 'node/desktop-only',
            githubUrl: 'https://github.com/node/desktop-only',
            version: '1.0.0',
            stylesCss: false,
          },
        }[pluginId] ?? {
          id: pluginId,
          name: pluginId,
          repo: requestUrl.searchParams.get('repo') ?? 'unknown/repo',
          githubUrl: undefined,
          version: '1.0.0',
          stylesCss: false,
        };
        return {
          ok: true,
          plugin: {
            id: fixtures.id,
            name: fixtures.name,
            repo: fixtures.repo,
            githubUrl: fixtures.githubUrl,
          },
          package: {
            manifest: {
              id: fixtures.id,
              name: fixtures.name,
              version: fixtures.version,
            },
            assets: {
              manifestJson: true,
              mainJs: true,
              stylesCss: fixtures.stylesCss,
            },
            source: {
              manifestUrl: `https://raw.githubusercontent.com/${fixtures.repo}/HEAD/manifest.json`,
              mainUrl: `https://raw.githubusercontent.com/${fixtures.repo}/HEAD/main.js`,
              stylesUrl: `https://raw.githubusercontent.com/${fixtures.repo}/HEAD/styles.css`,
            },
          },
          compatibility: {
            level: 'compatible',
            report: {
              obsidianApis: ['Plugin'],
              moduleImports: [],
              nodeModules: [],
              unsupportedModules: [],
              supportedApis: ['Plugin'],
              partialApis: [],
              unsupportedApis: [],
              blockers: [],
            },
          },
          installable: true,
          installBlockedReasons: [],
        };
      }

      if (url.startsWith('/api/obsidian/community-catalog/update-plan')) {
        return {
          ok: true,
          readOnly: true,
          writePolicy: 'preview-only',
          plugin: {
            id: 'dataview',
            name: 'Dataview',
            repo: 'blacksmithgu/obsidian-dataview',
            githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
          },
          installed: {
            pluginId: 'dataview',
            targetDir: '/tmp/mind/.plugins/dataview',
            version: '0.5.0',
            hasCommunityMetadata: true,
          },
          version: {
            installed: '0.5.0',
            remote: '0.5.1',
            state: 'update-available',
          },
          packageDigest: {
            algorithm: 'sha256',
            manifestJson: 'manifest-preview-digest',
            mainJs: 'main-preview-digest',
            stylesCss: 'styles-preview-digest',
            package: 'package-preview-digest',
          },
          updatable: true,
          blockedReasons: [],
          files: [
            { path: 'manifest.json', action: 'modify', localBytes: 40, remoteBytes: 42 },
            { path: 'main.js', action: 'modify', localBytes: 120, remoteBytes: 160 },
            { path: 'styles.css', action: 'unchanged' },
            { path: 'obsidian-community.json', action: 'refresh', localBytes: 80, generated: true },
          ],
          preflight: {
            ok: true,
            plugin: {
              id: 'dataview',
              name: 'Dataview',
              repo: 'blacksmithgu/obsidian-dataview',
              githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
            },
            package: {
              manifest: {
                id: 'dataview',
                name: 'Dataview',
                version: '0.5.1',
              },
              assets: {
                manifestJson: true,
                mainJs: true,
                stylesCss: true,
              },
              source: {
                manifestUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/manifest.json',
                mainUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/main.js',
                stylesUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/styles.css',
              },
              digest: {
                algorithm: 'sha256',
                manifestJson: 'manifest-preview-digest',
                mainJs: 'main-preview-digest',
                stylesCss: 'styles-preview-digest',
                package: 'package-preview-digest',
              },
            },
            compatibility: {
              level: 'compatible',
              report: {
                obsidianApis: ['Plugin'],
                moduleImports: [],
                nodeModules: [],
                unsupportedModules: [],
                supportedApis: ['Plugin'],
                partialApis: [],
                unsupportedApis: [],
                blockers: [],
              },
            },
            installable: true,
            installBlockedReasons: [],
          },
        };
      }

      if (url === '/api/obsidian/community-catalog/update') {
        return {
          ok: true,
          plugin: {
            id: 'dataview',
            name: 'Dataview',
            repo: 'blacksmithgu/obsidian-dataview',
            githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
          },
          updated: {
            pluginId: 'dataview',
            targetDir: '/tmp/mind/.plugins/dataview',
            previousVersion: '0.5.0',
            version: '0.5.1',
            source: 'obsidian-community',
            preservedDataJson: true,
            metadata: {
              schemaVersion: 1,
              source: 'obsidian-community',
              pluginId: 'dataview',
              repo: 'blacksmithgu/obsidian-dataview',
              manifestUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/manifest.json',
              mainUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/main.js',
              stylesUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/styles.css',
              packageDigest: {
                algorithm: 'sha256',
                manifestJson: 'manifest-preview-digest',
                mainJs: 'main-preview-digest',
                stylesCss: 'styles-preview-digest',
                package: 'package-preview-digest',
              },
              installedAt: '2026-06-13T00:00:00.000Z',
              updatedAt: '2026-06-14T00:00:00.000Z',
              previousVersion: '0.5.0',
              compatibilityLevel: 'compatible',
              installBlockedReasons: [],
            },
          },
          files: [
            { path: 'manifest.json', action: 'modify', localBytes: 40, remoteBytes: 42 },
            { path: 'main.js', action: 'modify', localBytes: 120, remoteBytes: 160 },
            { path: 'styles.css', action: 'unchanged' },
            { path: 'obsidian-community.json', action: 'refresh', localBytes: 80, generated: true },
          ],
          preflight: {
            ok: true,
            plugin: {
              id: 'dataview',
              name: 'Dataview',
              repo: 'blacksmithgu/obsidian-dataview',
              githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
            },
            package: {
              manifest: {
                id: 'dataview',
                name: 'Dataview',
                version: '0.5.1',
              },
              assets: {
                manifestJson: true,
                mainJs: true,
                stylesCss: true,
              },
              source: {
                manifestUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/manifest.json',
                mainUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/main.js',
                stylesUrl: 'https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/HEAD/styles.css',
              },
              digest: {
                algorithm: 'sha256',
                manifestJson: 'manifest-preview-digest',
                mainJs: 'main-preview-digest',
                stylesCss: 'styles-preview-digest',
                package: 'package-preview-digest',
              },
            },
            compatibility: {
              level: 'compatible',
              report: {
                obsidianApis: ['Plugin'],
                moduleImports: [],
                nodeModules: [],
                unsupportedModules: [],
                supportedApis: ['Plugin'],
                partialApis: [],
                unsupportedApis: [],
                blockers: [],
              },
            },
            installable: true,
            installBlockedReasons: [],
          },
          plugins: [],
        };
      }

      if (url.startsWith('/api/obsidian/community-catalog')) {
        return {
          ok: true,
          catalog: {
            source: {
              type: 'obsidian-releases',
              url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',
            },
            query: url.includes('q=data') ? 'data' : '',
            plugins: [
              {
                id: 'dataview',
                source: 'obsidian-community',
                name: 'Dataview',
                description: 'Query Markdown metadata',
                author: 'Blacksmith',
                repo: 'blacksmithgu/obsidian-dataview',
                githubUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
                installed: true,
                installStatus: 'enabled',
                installedVersion: '0.5.0',
                installedEnabled: true,
                installedLoaded: false,
              },
              {
                id: 'quickadd',
                source: 'obsidian-community',
                name: 'QuickAdd',
                description: 'Capture workflows',
                author: 'Christian',
                repo: 'chhoumann/quickadd',
                githubUrl: 'https://github.com/chhoumann/quickadd',
                installed: false,
                installStatus: 'available',
              },
              {
                id: 'desktop-only',
                source: 'obsidian-community',
                name: 'Desktop Only',
                description: 'Needs desktop APIs',
                author: 'Node User',
                repo: 'node/desktop-only',
                installed: true,
                installStatus: 'blocked',
                installedVersion: '1.2.0',
                installedEnabled: true,
                installedLoaded: false,
                installedLastError: 'Requires unsupported runtime module: fs',
              },
            ],
            counts: {
              total: 3,
              returned: 3,
              installed: 2,
              enabled: 2,
              blocked: 1,
              errors: 0,
            },
          },
          skipped: [{ index: 9, reason: 'bad entry' }],
        };
      }

      if (url.startsWith('/api/plugins/surfaces')) {
        return {
          ok: true,
          surfaces: [
            {
              id: 'obsidian:command:quickadd:capture',
              source: 'obsidian',
              kind: 'command',
              location: 'command-center',
              availability: 'available',
              pluginId: 'quickadd',
              pluginName: 'QuickAdd',
              title: 'Capture',
              host: { state: 'mounted', label: 'Command Center', description: 'Mounted command' },
              action: { type: 'obsidian-command', commandId: 'obsidian:quickadd:capture' },
              metadata: {
                hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'P' }],
                hotkeyPolicy: { binding: 'user-confirmable', status: 'ready', reason: 'Safe to bind after user confirmation.', conflicts: [] },
                hotkeyConflicts: [],
              },
            },
            {
              id: 'obsidian:ribbon:quickadd:0',
              source: 'obsidian',
              kind: 'ribbon',
              location: 'plugin-actions',
              availability: 'available',
              pluginId: 'quickadd',
              pluginName: 'QuickAdd',
              title: 'Capture action',
              host: { state: 'mounted', label: 'Plugin Entries', description: 'Mounted action' },
              action: { type: 'obsidian-ribbon', pluginId: 'quickadd', ribbonIndex: 0 },
            },
            {
              id: 'obsidian:view:quickadd:qa-view',
              source: 'obsidian',
              kind: 'view',
              location: 'plugin-views',
              availability: 'available',
              pluginId: 'quickadd',
              pluginName: 'QuickAdd',
              title: 'QuickAdd view',
              host: { state: 'mounted', label: 'Plugin Views', description: 'Mounted view' },
              action: { type: 'obsidian-view', pluginId: 'quickadd', viewType: 'qa-view' },
            },
            {
              id: 'obsidian:markdown:quickadd:post-process',
              source: 'obsidian',
              kind: 'markdown',
              location: 'document',
              availability: 'recorded',
              pluginId: 'quickadd',
              pluginName: 'QuickAdd',
              title: 'Markdown post processor',
              host: { state: 'mounted', label: 'Document rendering host', description: 'Mounted markdown hook' },
            },
            {
              id: 'obsidian:style:quickadd',
              source: 'obsidian',
              kind: 'style',
              location: 'plugin-assets',
              availability: 'recorded',
              pluginId: 'quickadd',
              pluginName: 'QuickAdd',
              title: 'QuickAdd stylesheet',
              host: { state: 'catalog', label: 'Stylesheet catalog', description: 'Catalog only' },
            },
            {
              id: 'obsidian:editor:quickadd:1',
              source: 'obsidian',
              kind: 'editor',
              location: 'editor',
              availability: 'blocked',
              pluginId: 'quickadd',
              pluginName: 'QuickAdd',
              title: 'Editor extension',
              host: { state: 'catalog', label: 'Editor gate', description: 'Needs browser editor gate' },
              metadata: {
                count: 2,
                mountPolicy: 'catalog-only',
                capabilityGate: {
                  capability: 'browser-editor-extension-host',
                  status: 'required',
                  autoEnable: false,
                  reason: 'CodeMirror extensions are browser-side objects.',
                  nextStep: 'Add sandbox and unload cleanup.',
                },
                editorExtensions: [
                  { id: 'quickadd:editor:1', serializable: false, mountStatus: 'catalog-only' },
                  { id: 'quickadd:editor:2', serializable: true, mountStatus: 'catalog-only' },
                ],
              },
            },
            {
              id: 'renderer:markdown',
              source: 'mindos-renderer',
              kind: 'document-renderer',
              location: 'document',
              availability: 'available',
              pluginId: 'markdown',
              pluginName: 'Markdown',
              title: 'Markdown renderer',
              host: { state: 'mounted', label: 'Document renderer', description: 'Built-in renderer' },
            },
          ],
        };
      }

      return {
        ok: true,
        plugins: [
          {
            id: 'markdown',
            source: 'mindos-renderer',
            name: 'Markdown',
            tags: ['notes'],
            builtin: true,
            core: true,
            enabled: true,
            loaded: true,
            status: 'core',
            surfaces: { total: 1, available: 1, recorded: 0, blocked: 0, disabled: 0, byKind: { 'document-renderer': 1 } },
          },
          {
            id: 'daily',
            source: 'mindos-renderer',
            name: 'Daily notes',
            tags: ['journal'],
            builtin: true,
            core: false,
            enabled: true,
            loaded: true,
            status: 'enabled',
            surfaces: { total: 2, available: 2, recorded: 0, blocked: 0, disabled: 0, byKind: { 'document-renderer': 1, command: 1 } },
          },
          {
            id: 'obsidian-capture',
            source: 'obsidian',
            name: 'Obsidian Capture',
            tags: [],
            builtin: false,
            core: false,
            enabled: true,
            loaded: true,
            status: 'loaded',
            surfaces: { total: 2, available: 1, recorded: 1, blocked: 0, disabled: 0, byKind: { command: 1, style: 1 } },
          },
        ],
        counts: {
          total: 3,
          enabled: 3,
          disabled: 0,
          loaded: 1,
          blocked: 0,
          errors: 0,
          bySource: {
            obsidian: 1,
            'mindos-renderer': 2,
          },
          surfaces: {
            total: 5,
            available: 4,
            recorded: 1,
            blocked: 0,
            disabled: 0,
            byKind: {
              command: 1,
              ribbon: 1,
              'document-renderer': 2,
              style: 1,
            },
          },
        },
      };
    });
  });

  it('groups renderers and imported Obsidian plugins under the installed panel', async () => {
    const { host, root } = await renderTab();

    expect(host.textContent).toContain('Plugin Manager');
    expect(host.textContent).toContain('MindOS renderers');
    expect(host.textContent).toContain('Markdown');
    expect(host.textContent).toContain('Daily notes');
    expect(host.textContent).toContain('Obsidian plugin host');
    expect(host.textContent).toContain('3');
    expect(host.textContent).toContain('plugins');
    expect(host.textContent).toContain('Obsidian');
    expect(host.textContent).toContain('5');
    expect(host.textContent).toContain('surfaces');
    expect(host.textContent).toContain('1 surface');
    expect(host.textContent).toContain('2 surfaces');
    expect(host.querySelector('[data-testid="obsidian-import"]')).toBeNull();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/plugins/catalog', { cache: 'no-store' });

    await cleanup(root, host);
  });

  it('refreshes catalog counts when plugin runtime state changes', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({
        ok: true,
        plugins: [],
        counts: {
          total: 2,
          enabled: 2,
          disabled: 0,
          loaded: 0,
          blocked: 0,
          errors: 0,
          bySource: { obsidian: 0, 'mindos-renderer': 2 },
          surfaces: { total: 2, available: 2, recorded: 0, blocked: 0, disabled: 0, byKind: {} },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        plugins: [
          {
            id: 'daily',
            source: 'mindos-renderer',
            name: 'Daily notes',
            tags: ['journal'],
            builtin: true,
            core: false,
            enabled: true,
            loaded: true,
            status: 'enabled',
            surfaces: { total: 3, available: 3, recorded: 0, blocked: 0, disabled: 0, byKind: { 'document-renderer': 1, command: 2 } },
          },
        ],
        counts: {
          total: 4,
          enabled: 4,
          disabled: 0,
          loaded: 1,
          blocked: 0,
          errors: 0,
          bySource: { obsidian: 2, 'mindos-renderer': 2 },
          surfaces: { total: 7, available: 6, recorded: 1, blocked: 0, disabled: 0, byKind: {} },
        },
      });
    const { host, root } = await renderTab();

    await act(async () => {
      window.dispatchEvent(new Event('mindos:plugins-changed'));
      await Promise.resolve();
    });

    expect(host.textContent).toContain('4');
    expect(host.textContent).toContain('7');
    expect(host.textContent).toContain('3 surfaces');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);

    await cleanup(root, host);
  });

  it('opens Obsidian import as a focused panel with the scanner expanded', async () => {
    const { host, root } = await renderTab();

    const importButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Import')) as HTMLButtonElement;

    await act(async () => {
      importButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="obsidian-import"]')?.textContent).toContain('import:true');
    expect(host.querySelector('[data-testid="obsidian-host"]')).toBeNull();

    await cleanup(root, host);
  });

  it('browses the gated Obsidian community catalog and installs after preflight confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const packageChanged = vi.fn();
    window.addEventListener('mindos:obsidian-plugin-packages-changed', packageChanged);
    const { host, root } = await renderTab();

    try {
      const communityButton = Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Community')) as HTMLButtonElement;

      await act(async () => {
        communityButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/obsidian/community-catalog?limit=80', { cache: 'no-store' });
      expect(host.textContent).toContain('Obsidian Community');
      expect(host.textContent).toContain('gated install');
      expect(host.textContent).toContain('Official Obsidian index');
      expect(host.textContent).toContain('Dataview');
      expect(host.textContent).toContain('QuickAdd');
      expect(host.textContent).toContain('Desktop Only');
      expect(host.textContent).toContain('Requires unsupported runtime module: fs');
      expect(host.textContent).toContain('1 skipped');
      expect(host.textContent).toContain('Run Check before installing.');
      expect(host.textContent).toContain('Check update');

      const updateCheckButton = host.querySelector('[data-obsidian-community-preflight="dataview"]') as HTMLButtonElement;
      await act(async () => {
        updateCheckButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/preflight?repo=blacksmithgu%2Fobsidian-dataview&pluginId=dataview',
        { cache: 'no-store' },
      );
      expect(host.textContent).toContain('Update available');
      expect(host.textContent).toContain('local 0.5.0 · remote 0.5.1');
      expect(host.textContent).toContain('Remote package is newer. No remote reset.');
      expect(host.querySelector('[data-obsidian-community-install="dataview"]')).toBeNull();

      const previewPlanButton = host.querySelector('[data-obsidian-community-update-plan="dataview"]') as HTMLButtonElement;
      await act(async () => {
        previewPlanButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/update-plan?repo=blacksmithgu%2Fobsidian-dataview&pluginId=dataview',
        { cache: 'no-store' },
      );
      expect(host.textContent).toContain('Read-only update plan');
      expect(host.textContent).toContain('preview-only');
      expect(host.textContent).toContain('Preview only. No files changed.');
      expect(host.textContent).toContain('manifest.json');
      expect(host.textContent).toContain('modify 40>42');
      expect(host.textContent).toContain('obsidian-community.json');
      expect(host.textContent).toContain('refresh 80>-');

      const applyUpdateButton = host.querySelector('[data-obsidian-community-update-apply="dataview"]') as HTMLButtonElement;
      expect(applyUpdateButton).toBeTruthy();
      await act(async () => {
        applyUpdateButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(confirmSpy).toHaveBeenCalledWith('Apply Dataview 0.5.1?');
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/update',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repo: 'blacksmithgu/obsidian-dataview',
            pluginId: 'dataview',
            confirm: true,
            expectedRemoteVersion: '0.5.1',
            expectedPackageDigest: 'package-preview-digest',
          }),
        }),
      );
      expect(packageChanged).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('Updated locally 0.5.1');
      expect(host.textContent).not.toContain('Read-only update plan');
      expect(host.querySelector('[data-obsidian-community-update-apply="dataview"]')).toBeNull();

      const localNewerButton = host.querySelector('[data-obsidian-community-preflight="desktop-only"]') as HTMLButtonElement;
      await act(async () => {
        localNewerButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(host.textContent).toContain('Local version is newer');
      expect(host.textContent).toContain('local 1.2.0 · remote 1.0.0');

      const preflightButton = host.querySelector('[data-obsidian-community-preflight="quickadd"]') as HTMLButtonElement;
      await act(async () => {
        preflightButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/preflight?repo=chhoumann%2Fquickadd&pluginId=quickadd',
        { cache: 'no-store' },
      );
      expect(host.textContent).toContain('Preflight passed');
      expect(host.textContent).toContain('manifest 1.0.0 · styles none');
      expect(host.textContent).toContain('No blockers');

      const installButton = host.querySelector('[data-obsidian-community-install="quickadd"]') as HTMLButtonElement;
      expect(installButton).toBeTruthy();
      await act(async () => {
        installButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(confirmSpy).toHaveBeenCalledWith('Install QuickAdd?');
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/api/obsidian/community-catalog/install',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repo: 'chhoumann/quickadd',
            pluginId: 'quickadd',
            confirm: true,
          }),
        }),
      );
      expect(packageChanged).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain('Installed 1.0.0');
      expect(host.querySelector('[data-obsidian-community-manage="quickadd"]')).toBeTruthy();

      const manageButton = host.querySelector('[data-obsidian-community-manage="dataview"]') as HTMLButtonElement;
      await act(async () => {
        manageButton.click();
        await Promise.resolve();
      });

      expect(host.querySelector('[data-testid="obsidian-host"]')?.textContent).toContain('focus:dataview');
    } finally {
      window.removeEventListener('mindos:obsidian-plugin-packages-changed', packageChanged);
      confirmSpy.mockRestore();
      await cleanup(root, host);
    }
  });

  it('searches the community catalog route', async () => {
    const { host, root } = await renderTab();

    const communityButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Community')) as HTMLButtonElement;

    await act(async () => {
      communityButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('[data-obsidian-community-search]') as HTMLInputElement;
    const submit = host.querySelector('[data-obsidian-community-search-submit]') as HTMLButtonElement;

    await act(async () => {
      setInputValue(input, 'data');
      await Promise.resolve();
    });

    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/obsidian/community-catalog?limit=80&q=data', { cache: 'no-store' });
    expect(host.textContent).toContain('Search: data');

    await cleanup(root, host);
  });

  it('filters the installed inventory by Obsidian-style status buckets', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      plugins: [
        {
          id: 'markdown',
          source: 'mindos-renderer',
          name: 'Markdown',
          tags: ['notes'],
          builtin: true,
          core: true,
          enabled: true,
          loaded: true,
          status: 'core',
          surfaces: { total: 1, available: 1, recorded: 0, blocked: 0, disabled: 0, byKind: { 'document-renderer': 1 } },
        },
        {
          id: 'disabled-renderer',
          source: 'mindos-renderer',
          name: 'Disabled renderer',
          tags: [],
          builtin: true,
          core: false,
          enabled: false,
          loaded: false,
          status: 'disabled',
          surfaces: { total: 1, available: 0, recorded: 0, blocked: 0, disabled: 1, byKind: { 'document-renderer': 1 } },
        },
        {
          id: 'quickadd-like',
          source: 'obsidian',
          name: 'QuickAdd Like',
          tags: [],
          builtin: false,
          core: false,
          enabled: true,
          loaded: true,
          status: 'loaded',
          compatibility: { level: 'full', kind: 'ready', label: 'Ready', reason: 'Supported', blockers: [] },
          surfaces: { total: 2, available: 1, recorded: 1, blocked: 0, disabled: 0, byKind: { command: 1, style: 1 } },
        },
        {
          id: 'blocked-obsidian',
          source: 'obsidian',
          name: 'Blocked Obsidian',
          tags: [],
          builtin: false,
          core: false,
          enabled: false,
          loaded: false,
          status: 'blocked',
          compatibility: { level: 'blocked', kind: 'blocked', label: 'Blocked', reason: 'Uses unsupported desktop APIs.', blockers: ['desktop APIs'] },
          surfaces: { total: 0, available: 0, recorded: 0, blocked: 0, disabled: 0, byKind: {} },
        },
      ],
      counts: {
        total: 4,
        enabled: 2,
        disabled: 2,
        loaded: 1,
        blocked: 1,
        errors: 0,
        bySource: { obsidian: 2, 'mindos-renderer': 2 },
        surfaces: { total: 4, available: 2, recorded: 1, blocked: 0, disabled: 1, byKind: {} },
      },
    });
    const { host, root } = await renderTab();

    const problemButton = host.querySelector('[data-plugin-catalog-filter="problem"]') as HTMLButtonElement;
    await act(async () => {
      problemButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Problem inventory');
    expect(host.textContent).toContain('Blocked Obsidian');
    expect(host.textContent).toContain('Uses unsupported desktop APIs.');
    expect(host.textContent).not.toContain('QuickAdd Like');

    const obsidianButton = host.querySelector('[data-plugin-catalog-filter="obsidian"]') as HTMLButtonElement;
    await act(async () => {
      obsidianButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Obsidian inventory');
    expect(host.textContent).toContain('QuickAdd Like');
    expect(host.textContent).toContain('Blocked Obsidian');
    expect(host.textContent).not.toContain('Disabled renderer');

    const openQuickAddButton = host.querySelector('[data-plugin-catalog-open-host="quickadd-like"]') as HTMLButtonElement;
    await act(async () => {
      openQuickAddButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="obsidian-host"]')?.textContent).toContain('focus:quickadd-like');

    await cleanup(root, host);
  });

  it('exposes plugin surface shortcuts without duplicating import or host content', async () => {
    const { host, root } = await renderTab();

    const surfacesButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Surfaces')) as HTMLButtonElement;

    await act(async () => {
      surfacesButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/plugins/surfaces', { cache: 'no-store' });
    expect(host.textContent).toContain('Live surface inventory');
    expect(host.textContent).toContain('Obsidian hotkeys');
    expect(host.textContent).toContain('Bindable');
    expect(host.textContent).toContain('Browser editor gate');
    expect(host.textContent).toContain('Editor gate description');
    expect(host.textContent).toContain('Gate required');
    expect(host.textContent).toContain('Catalog-only');
    expect(host.textContent).toContain('Extensions');
    expect(host.textContent).toContain('Plugins');
    expect(host.textContent).toContain('Serializable');
    expect(host.textContent).toContain('Total');
    expect(host.textContent).toContain('7');
    expect(host.textContent).toContain('Mounted');
    expect(host.textContent).toContain('5');
    expect(host.textContent).toContain('Catalog');
    expect(host.textContent).toContain('2');
    expect(host.textContent).toContain('Recorded');
    expect(host.textContent).toContain('2');
    expect(host.textContent).toContain('Blocked');
    expect(host.textContent).toContain('1');
    expect(host.textContent).toContain('Commands');
    expect(host.textContent).toContain('Ribbon actions');
    expect(host.textContent).toContain('Plugin views');
    expect(host.textContent).toContain('Markdown hooks');
    expect(host.textContent).toContain('Stylesheets');
    expect(host.textContent).toContain('Editor extensions');
    expect(host.textContent).toContain('Document renderers');
    expect(host.textContent).toContain('Command Center');
    expect(host.textContent).toContain('Plugin Entries');
    expect(host.textContent).toContain('Plugin Views');
    expect(host.querySelector('[data-testid="obsidian-import"]')).toBeNull();
    expect(host.querySelector('[data-testid="obsidian-host"]')).toBeNull();

    const hotkeyToggle = Array.from(host.querySelectorAll('button[role="switch"]'))
      .find((button) => button.getAttribute('aria-checked') === 'false') as HTMLButtonElement;

    await act(async () => {
      hotkeyToggle.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem(OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY)).toBe('1');
    expect(host.textContent).toContain('Enabled');

    const openButtons = Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent?.trim() === 'Open');

    await act(async () => {
      openButtons[0].click();
      openButtons[1].click();
      openButtons[2].click();
      await Promise.resolve();
    });

    expect(mocks.openCommandCenter).toHaveBeenCalledTimes(1);
    expect(mocks.openEntries).toHaveBeenCalledTimes(1);
    expect(mocks.openViews).toHaveBeenCalledTimes(1);

    await cleanup(root, host);
  });
});
