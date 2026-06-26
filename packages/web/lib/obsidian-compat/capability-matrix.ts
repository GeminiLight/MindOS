export type ObsidianCapabilitySupport =
  | 'full'
  | 'limited'
  | 'snapshot-only'
  | 'catalog-only'
  | 'request-only'
  | 'unsupported';

export type ObsidianCapabilitySurface =
  | 'commands'
  | 'settings'
  | 'entries'
  | 'views'
  | 'document'
  | 'styles'
  | 'editor'
  | 'secret'
  | 'vault'
  | 'metadata'
  | 'workspace'
  | 'network'
  | 'core'
  | 'unsupported';

export interface ObsidianCapabilityRow {
  api: string;
  surface: ObsidianCapabilitySurface;
  support: ObsidianCapabilitySupport;
  host: string;
  route?: string;
  tests?: string[];
  notes: string;
}

export interface ObsidianCapabilityReportLike {
  obsidianApis: string[];
  unsupportedApis?: string[];
}

export interface ObsidianCapabilityCoverage {
  api: string;
  surface: ObsidianCapabilitySurface;
  support: ObsidianCapabilitySupport;
  host: string;
  route?: string;
  notes: string;
}

export interface ObsidianCapabilitySurfaceSummary {
  surface: ObsidianCapabilitySurface;
  apiCount: number;
  supportSummary: Record<ObsidianCapabilitySupport, number>;
  apis: string[];
  hosts: string[];
  routes: string[];
}

const SURFACE_ORDER: ObsidianCapabilitySurface[] = [
  'commands',
  'settings',
  'views',
  'document',
  'network',
  'secret',
  'editor',
  'vault',
  'metadata',
  'workspace',
  'entries',
  'styles',
  'core',
  'unsupported',
];

function emptySupportSummary(): Record<ObsidianCapabilitySupport, number> {
  return {
    full: 0,
    limited: 0,
    'snapshot-only': 0,
    'catalog-only': 0,
    'request-only': 0,
    unsupported: 0,
  };
}

export const OBSIDIAN_CAPABILITY_MATRIX: ObsidianCapabilityRow[] = [
  {
    api: 'Plugin',
    surface: 'core',
    support: 'full',
    host: 'PluginLoader',
    tests: ['obsidian-compat/loader.test.ts', 'obsidian-compat/integration.test.ts'],
    notes: 'Base plugin lifecycle is loaded through the MindOS plugin loader.',
  },
  {
    api: 'Component',
    surface: 'core',
    support: 'full',
    host: 'Component cleanup registry',
    tests: ['obsidian-compat/component-plugin.test.ts'],
    notes: 'Component load/unload hooks and registered disposers are supported.',
  },
  {
    api: 'Events',
    surface: 'core',
    support: 'full',
    host: 'Events shim',
    tests: ['obsidian-compat/component-plugin.test.ts'],
    notes: 'Event registration and cleanup use the local compatibility event emitter.',
  },
  {
    api: 'Notice',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/ui.test.ts', 'obsidian-compat/runtime-host.test.ts'],
    notes: 'Notices are recorded as safe snapshots instead of native Obsidian toast DOM.',
  },
  {
    api: 'Modal',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Modal content is exposed as a safe text or DOM snapshot.',
  },
  {
    api: 'Menu',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['api/obsidian-plugins.menu-interactions.test.ts'],
    notes: 'Menus are captured as snapshots; executable choices require explicit user continuation.',
  },
  {
    api: 'MenuItem',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['api/obsidian-plugins.menu-interactions.test.ts'],
    notes: 'Menu item state is serialized for safe review before execution.',
  },
  {
    api: 'SuggestModal',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['api/obsidian-plugins.suggest-modal.test.ts'],
    notes: 'Suggestions are exposed as a bounded snapshot with explicit continuation.',
  },
  {
    api: 'FuzzySuggestModal',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['api/obsidian-plugins.suggest-modal.test.ts'],
    notes: 'Fuzzy suggestions use the same bounded snapshot host as SuggestModal.',
  },
  {
    api: 'PluginSettingTab',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts', 'obsidian-compat/integration.test.ts'],
    notes: 'Settings tabs are serialized and editable from the MindOS plugin host.',
  },
  {
    api: 'Setting',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Common setting controls are captured and routed through explicit setting actions.',
  },
  {
    api: 'ButtonComponent',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Standalone button controls are captured as setting actions.',
  },
  {
    api: 'TextComponent',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Standalone text controls are captured as setting values.',
  },
  {
    api: 'TextAreaComponent',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Standalone textarea controls are captured as setting values.',
  },
  {
    api: 'ToggleComponent',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Standalone toggle controls are captured as setting values.',
  },
  {
    api: 'DropdownComponent',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/ui.test.ts'],
    notes: 'Standalone dropdown controls are captured as setting values.',
  },
  {
    api: 'SecretComponent',
    surface: 'settings',
    support: 'limited',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Secret input UI is represented as a masked compatibility control; SecretStorage handles persisted secret values.',
  },
  {
    api: 'SecretStorage',
    surface: 'secret',
    support: 'limited',
    host: 'MindOS plugin secret vault',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/secret-storage.test.ts', 'obsidian-compat/loader.test.ts'],
    notes: 'SecretStorage uses a plugin-scoped encrypted local file backend; Desktop keychain/native broker remains a future hardening step.',
  },
  {
    api: 'Plugin.getSettingDefinitions',
    surface: 'settings',
    support: 'catalog-only',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['api/obsidian-plugins.settings.test.ts', 'settings/obsidian-plugin-host-section.test.tsx'],
    notes: 'Declarative settings definitions are detected and serialized as a read-only settings catalog; editable declarative controls/actions remain behind a future settings host gate.',
  },
  {
    api: 'addCommand',
    surface: 'commands',
    support: 'full',
    host: 'Command Center',
    route: '/api/obsidian-plugins',
    tests: ['api/obsidian-plugins.command-actions.test.ts'],
    notes: 'Commands are registered in the MindOS command registry.',
  },
  {
    api: 'removeCommand',
    surface: 'commands',
    support: 'full',
    host: 'Command Center',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'Commands can be removed from the local registry.',
  },
  {
    api: 'Commands.listCommands',
    surface: 'commands',
    support: 'limited',
    host: 'Command Center',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Plugins can enumerate commands registered in the MindOS command registry; native Obsidian core commands are not synthesized.',
  },
  {
    api: 'addSettingTab',
    surface: 'settings',
    support: 'full',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Plugin setting tabs are mounted into the plugin host after load.',
  },
  {
    api: 'addRibbonIcon',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'Ribbon icons appear as explicit plugin entries rather than Obsidian sidebar icons.',
  },
  {
    api: 'addStatusBarItem',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'Status bar items are recorded as plugin entries.',
  },
  {
    api: 'TFile',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'MindOS exposes Obsidian-compatible file objects for local vault files.',
  },
  {
    api: 'TFolder',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'MindOS exposes Obsidian-compatible folder objects for local vault folders.',
  },
  {
    api: 'TAbstractFile',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Shared file/folder base object is supported by the vault shim.',
  },
  {
    api: 'Vault',
    surface: 'vault',
    support: 'limited',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Vault class helpers such as recurseChildren are available; file operations remain scoped to the local MindOS vault.',
  },
  {
    api: 'normalizePath',
    surface: 'core',
    support: 'full',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Path normalization follows Obsidian-style slash cleanup.',
  },
  {
    api: 'parseYaml',
    surface: 'core',
    support: 'full',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'YAML parsing is backed by the same parser used by MindOS frontmatter handling.',
  },
  {
    api: 'stringifyYaml',
    surface: 'core',
    support: 'full',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'YAML serialization is backed by the same serializer used by MindOS frontmatter handling.',
  },
  {
    api: 'htmlToMarkdown',
    surface: 'document',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts', 'obsidian-compat/compatibility-report.test.ts'],
    notes: 'HTML-to-Markdown conversion uses the existing Turndown dependency and falls back to text for non-standard shim elements; it does not mount or execute plugin DOM.',
  },
  {
    api: 'getLinkpath',
    surface: 'metadata',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts', 'obsidian-compat/compatibility-report.test.ts'],
    notes: 'Link text parsing strips alias and subpath components for common wiki-link targets; full Obsidian path resolution still belongs to MetadataCache.',
  },
  {
    api: 'parseLinktext',
    surface: 'metadata',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts', 'obsidian-compat/compatibility-report.test.ts'],
    notes: 'Link text parsing returns path and #subpath for common wiki-link targets; it does not resolve files or headings.',
  },
  {
    api: 'arrayBufferToBase64',
    surface: 'core',
    support: 'full',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts', 'obsidian-compat/compatibility-report.test.ts'],
    notes: 'Binary conversion is implemented as a pure ArrayBuffer/base64 transform.',
  },
  {
    api: 'base64ToArrayBuffer',
    surface: 'core',
    support: 'full',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts', 'obsidian-compat/compatibility-report.test.ts'],
    notes: 'Binary conversion is implemented as a pure base64/ArrayBuffer transform.',
  },
  {
    api: 'debounce',
    surface: 'core',
    support: 'full',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Debounced callbacks run in-process and expose a cancel method compatible with common Obsidian plugin usage.',
  },
  {
    api: 'addIcon',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Custom icon SVG is registered for compatibility; MindOS renders safe icon metadata instead of injecting arbitrary SVG globally.',
  },
  {
    api: 'getIcon',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Registered icon content is available to compatibility code without global icon injection.',
  },
  {
    api: 'getIconIds',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Icon id enumeration returns MindOS known icon ids plus plugin-registered ids.',
  },
  {
    api: 'setIcon',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Icon application records safe DOM metadata and text fallback rather than injecting Obsidian SVG chrome.',
  },
  {
    api: 'setTooltip',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Tooltips map to title and aria-label attributes on the compatibility element.',
  },
  {
    api: 'Platform',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Platform flags describe the MindOS host, not the native Obsidian app shell.',
  },
  {
    api: 'moment',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Moment-compatible date access is provided as a lightweight compatibility export.',
  },
  {
    api: 'Keymap',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Modifier-key helpers are provided for common command and menu guards.',
  },
  {
    api: 'Scope',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor suggest catalog',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Key scope registrations are kept in-memory for plugin compatibility; MindOS does not attach them to global editor keyboard handling.',
  },
  {
    api: 'parseFrontMatterAliases',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Alias extraction is backed by MindOS frontmatter parsing.',
  },
  {
    api: 'parseFrontMatterTags',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Tag extraction is backed by MindOS frontmatter parsing.',
  },
  {
    api: 'getAllTags',
    surface: 'metadata',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Tag aggregation reads frontmatter tags and parsed body tag caches, normalizes # prefixes, and does not trigger a full Obsidian metadata index.',
  },
  {
    api: 'getLanguage',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Language detection uses the host browser locale and falls back to English.',
  },
  {
    api: 'apiVersion',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'A MindOS compatibility API version is exposed for feature guards.',
  },
  {
    api: 'requireApiVersion',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Version checks compare against the MindOS compatibility API version rather than the full installed Obsidian app version.',
  },
  {
    api: 'prepareFuzzySearch',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Fuzzy search falls back to a deterministic substring matcher.',
  },
  {
    api: 'prepareSimpleSearch',
    surface: 'core',
    support: 'limited',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Simple search uses the same deterministic substring matcher as the compatibility fuzzy search helper.',
  },
  {
    api: 'renderMatches',
    surface: 'document',
    support: 'snapshot-only',
    host: 'Obsidian module shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Search matches are rendered into safe compatibility elements with static highlight spans.',
  },
  {
    api: 'CustomCss.getSnippetPath',
    surface: 'styles',
    support: 'limited',
    host: 'Custom CSS compatibility shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Snippet paths are redirected to a MindOS-controlled compatibility directory instead of Obsidian CSS settings.',
  },
  {
    api: 'CustomCss.setCssEnabledStatus',
    surface: 'styles',
    support: 'catalog-only',
    host: 'Custom CSS compatibility shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Snippet enable/disable requests are recorded as compatibility warnings and do not mutate Obsidian appearance settings.',
  },
  {
    api: 'CustomCss.readSnippets',
    surface: 'styles',
    support: 'catalog-only',
    host: 'Custom CSS compatibility shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Snippet reload requests are recorded as no-ops until MindOS exposes a browser style host.',
  },
  {
    api: 'CodeMirror',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor compatibility shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Global CodeMirror mode registration is kept in a local compatibility map; live editor integration remains gated.',
  },
  {
    api: 'CodeMirrorAdapter.commands',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor compatibility shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'CodeMirrorAdapter command overrides are recorded in a local command map without patching a live editor.',
  },
  {
    api: 'AbstractInputSuggest',
    surface: 'entries',
    support: 'snapshot-only',
    host: 'Plugin entries dock',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Input suggest classes can be constructed; suggestion rendering is exposed through compatibility snapshots when invoked.',
  },
  {
    api: 'EditorSuggest',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor suggest catalog',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'EditorSuggest can be extended and registered, but live cursor-triggered editor integration remains behind the editor suggest host gate.',
  },
  {
    api: 'View',
    surface: 'views',
    support: 'catalog-only',
    host: 'Plugin view registry',
    route: '/api/obsidian-plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'View base class is available for inheritance guards; MindOS does not mount native Obsidian panes.',
  },
  {
    api: 'FileView',
    surface: 'views',
    support: 'catalog-only',
    host: 'Plugin view registry',
    route: '/api/obsidian-plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'FileView base class is available for inheritance guards; MindOS does not mount native Obsidian panes.',
  },
  {
    api: 'SettingGroup',
    surface: 'settings',
    support: 'limited',
    host: 'Plugin settings host',
    route: '/api/obsidian-plugins/settings',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Setting groups provide a lightweight container for plugin settings UI.',
  },
  {
    api: 'loadData',
    surface: 'vault',
    support: 'full',
    host: 'Plugin data store',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Plugin data is stored in the local plugin directory.',
  },
  {
    api: 'saveData',
    surface: 'vault',
    support: 'full',
    host: 'Plugin data store',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Plugin data is stored in the local plugin directory.',
  },
  {
    api: 'Vault.read',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Text reads are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.readBinary',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Binary reads are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.cachedRead',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Cached reads currently use the same local read path.',
  },
  {
    api: 'Vault.create',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Text creates are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.createBinary',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Binary creates are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.modify',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Text modifies are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.modifyBinary',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Binary modifies are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.append',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Text appends are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.appendBinary',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Binary appends are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.process',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Text process callbacks are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.getResourcePath',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Resource paths use the MindOS vault URL scheme.',
  },
  {
    api: 'Vault.getConfig',
    surface: 'vault',
    support: 'limited',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Returns a compatibility config map for common theme/editor settings without reading private .obsidian internals.',
  },
  {
    api: 'Vault.setConfig',
    surface: 'vault',
    support: 'limited',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Updates the in-memory compatibility config map and emits a config-changed event; it does not mutate .obsidian config files.',
  },
  {
    api: 'Vault.delete',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Deletes are scoped to the local MindOS vault and protected from private system directories.',
  },
  {
    api: 'Vault.trash',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Local trash is supported; system trash can gracefully fall back.',
  },
  {
    api: 'Vault.rename',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Renames are scoped to the local MindOS vault.',
  },
  {
    api: 'Vault.copy',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Copies preserve binary content inside the local MindOS vault.',
  },
  {
    api: 'Vault.adapter',
    surface: 'vault',
    support: 'limited',
    host: 'DataAdapter shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Adapter operations are local-vault scoped and block private system directories.',
  },
  {
    api: 'Vault.getAbstractFileByPath',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Resolves local vault files and folders while hiding private directories.',
  },
  {
    api: 'Vault.getFileByPath',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Resolves local vault files while hiding private directories.',
  },
  {
    api: 'Vault.getFolderByPath',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Resolves local vault folders while hiding private directories.',
  },
  {
    api: 'Vault.getFiles',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Lists user vault files and hides MindOS/private plugin internals.',
  },
  {
    api: 'Vault.getMarkdownFiles',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Lists markdown files from the local MindOS vault.',
  },
  {
    api: 'Vault.getAllLoadedFiles',
    surface: 'vault',
    support: 'full',
    host: 'Vault shim',
    tests: ['obsidian-compat/vault.test.ts'],
    notes: 'Lists loaded local vault files and folders.',
  },
  {
    api: 'MetadataCache.getCache',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Returns parsed markdown metadata for local vault files.',
  },
  {
    api: 'MetadataCache.getFileCache',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Returns parsed markdown metadata for TFile inputs.',
  },
  {
    api: 'MetadataCache.getFirstLinkpathDest',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Resolves local markdown link targets using the MindOS vault.',
  },
  {
    api: 'MetadataCache.fileToLinktext',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Builds Obsidian-style link text for local vault files.',
  },
  {
    api: 'MetadataCache.resolvedLinks',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Resolved link maps are maintained from local vault metadata.',
  },
  {
    api: 'MetadataCache.unresolvedLinks',
    surface: 'metadata',
    support: 'full',
    host: 'Metadata cache shim',
    tests: ['obsidian-compat/metadata-cache.test.ts'],
    notes: 'Unresolved link maps are maintained from local vault metadata.',
  },
  {
    api: 'FileManager.processFrontMatter',
    surface: 'vault',
    support: 'full',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Frontmatter edits are applied to local markdown files.',
  },
  {
    api: 'FileManager.generateMarkdownLink',
    surface: 'vault',
    support: 'full',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Markdown links are generated for local vault files.',
  },
  {
    api: 'FileManager.getNewFileParent',
    surface: 'vault',
    support: 'full',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'New file parents are resolved inside the local MindOS vault.',
  },
  {
    api: 'FileManager.renameFile',
    surface: 'vault',
    support: 'full',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Renames are delegated to the vault shim.',
  },
  {
    api: 'FileManager.promptForDeletion',
    surface: 'vault',
    support: 'limited',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Deletion prompts are represented by MindOS-controlled deletion flows.',
  },
  {
    api: 'FileManager.trashFile',
    surface: 'vault',
    support: 'full',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Trash operations are delegated to the vault shim.',
  },
  {
    api: 'FileManager.getAvailablePathForAttachment',
    surface: 'vault',
    support: 'full',
    host: 'FileManager shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Attachment paths are resolved inside the local MindOS vault.',
  },
  {
    api: 'Workspace.openLinkText',
    surface: 'workspace',
    support: 'request-only',
    host: 'Workspace request recorder',
    route: '/api/obsidian-plugins',
    tests: ['api/obsidian-plugins.command-actions.test.ts'],
    notes: 'MindOS records the request; it does not take over the native Obsidian workspace layout.',
  },
  {
    api: 'Workspace.on',
    surface: 'workspace',
    support: 'limited',
    host: 'Workspace event shim',
    tests: ['obsidian-compat/workflow-probes.test.ts'],
    notes: 'Workspace event listeners are registered and cleaned up through the compatibility host; only explicit MindOS-triggered event flows are mounted.',
  },
  {
    api: 'Workspace.trigger',
    surface: 'workspace',
    support: 'limited',
    host: 'Workspace event shim',
    tests: ['obsidian-compat/workflow-probes.test.ts'],
    notes: 'Workspace events can be triggered inside the compatibility host, but MindOS does not mirror the full native Obsidian workspace event stream.',
  },
  {
    api: 'Workspace.editor-menu',
    surface: 'workspace',
    support: 'limited',
    host: 'Workspace editor-menu probe host',
    route: '/api/obsidian-plugins',
    tests: ['obsidian-compat/workflow-probes.test.ts'],
    notes: 'MindOS can synthesize a bounded editor-menu event with tag token context for workflow probes and safe menu continuation.',
  },
  {
    api: 'Workspace.onLayoutReady',
    surface: 'workspace',
    support: 'limited',
    host: 'Workspace shim',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Callbacks run when the MindOS compatibility workspace is ready.',
  },
  {
    api: 'Workspace.getActiveFile',
    surface: 'workspace',
    support: 'limited',
    host: 'Workspace shim',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Active file is provided from the current MindOS plugin action context.',
  },
  {
    api: 'Workspace.getActiveViewOfType',
    surface: 'workspace',
    support: 'limited',
    host: 'Workspace shim',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Active views are compatibility objects, not native Obsidian leaves.',
  },
  {
    api: 'Workspace.iterateRootLeaves',
    surface: 'workspace',
    support: 'catalog-only',
    host: 'Workspace shim',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Leaves are compatibility catalog entries, not native layout leaves.',
  },
  {
    api: 'Workspace.iterateAllLeaves',
    surface: 'workspace',
    support: 'catalog-only',
    host: 'Workspace shim',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Leaves are compatibility catalog entries, not native layout leaves.',
  },
  {
    api: 'Workspace.iterateCodeMirrors',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor compatibility shim',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'CodeMirror iteration is a no-op compatibility hook until MindOS exposes a browser editor plugin host.',
  },
  {
    api: 'Workspace.getLeaf',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Leaves are compatibility hosts for snapshots and text output.',
  },
  {
    api: 'Workspace.getLeftLeaf',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Left sidebar leaves are compatibility snapshot hosts, not native Obsidian sidebar panes.',
  },
  {
    api: 'Workspace.getRightLeaf',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Right sidebar leaves are compatibility snapshot hosts, not native Obsidian sidebar panes.',
  },
  {
    api: 'Workspace.getLeavesOfType',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Returns compatibility leaves for registered plugin view types.',
  },
  {
    api: 'WorkspaceLeaf',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/workspace.test.ts'],
    notes: 'Leaf operations target MindOS compatibility view snapshots.',
  },
  {
    api: 'registerView',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'Custom views are exposed through the MindOS plugin view host.',
  },
  {
    api: 'registerExtensions',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'View extensions are registered as compatibility metadata.',
  },
  {
    api: 'ItemView',
    surface: 'views',
    support: 'limited',
    host: 'Plugin view host',
    route: '/plugins/views',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'ItemView output is rendered through a snapshot/text host.',
  },
  {
    api: 'MarkdownView',
    surface: 'document',
    support: 'limited',
    host: 'Markdown snapshot host',
    route: '/api/obsidian-plugins/markdown-code-blocks',
    tests: ['api/obsidian-plugins.markdown-host.test.ts'],
    notes: 'Markdown views are compatibility wrappers for local document snapshots.',
  },
  {
    api: 'MarkdownRenderChild',
    surface: 'document',
    support: 'limited',
    host: 'Markdown snapshot host',
    route: '/api/obsidian-plugins/markdown-code-blocks',
    tests: ['obsidian-compat/markdown-renderer.test.ts'],
    notes: 'Render children are lifecycle wrappers inside the compatibility renderer.',
  },
  {
    api: 'MarkdownRenderer',
    surface: 'document',
    support: 'limited',
    host: 'Markdown renderer shim',
    route: '/api/obsidian-plugins/markdown-code-blocks',
    tests: ['obsidian-compat/markdown-renderer.test.ts'],
    notes: 'The renderer seeds safe DOM output; it is not the native Obsidian markdown pipeline.',
  },
  {
    api: 'registerMarkdownPostProcessor',
    surface: 'document',
    support: 'limited',
    host: 'Markdown post processor host',
    route: '/api/obsidian-plugins/markdown-post-processors',
    tests: ['api/obsidian-plugins.markdown-host.test.ts'],
    notes: 'Post processors run against safe document snapshots.',
  },
  {
    api: 'registerMarkdownCodeBlockProcessor',
    surface: 'document',
    support: 'limited',
    host: 'Markdown code block host',
    route: '/api/obsidian-plugins/markdown-code-blocks',
    tests: ['api/obsidian-plugins.markdown-host.test.ts'],
    notes: 'Code block processors run against safe document snapshots.',
  },
  {
    api: 'registerEditorExtension',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor extension catalog',
    tests: ['obsidian-compat/runtime-host.test.ts'],
    notes: 'Editor extensions are recorded with a P3a browser editor sandbox plan; MindOS does not auto-mount CodeMirror extensions into live editors.',
  },
  {
    api: 'registerEditorSuggest',
    surface: 'editor',
    support: 'catalog-only',
    host: 'Editor suggest catalog',
    tests: ['obsidian-compat/integration.test.ts'],
    notes: 'Editor suggestions are recorded with a browser suggest sandbox plan; MindOS does not attach them to live cursor events until the editor suggest host exists.',
  },
  {
    api: 'request',
    surface: 'network',
    support: 'limited',
    host: 'Restricted network shim',
    tests: ['obsidian-compat/request-url.test.ts'],
    notes: 'Network requests are limited to http/https, size-limited, timeout-limited, and local/private hosts are blocked.',
  },
  {
    api: 'requestUrl',
    surface: 'network',
    support: 'limited',
    host: 'Restricted network shim',
    tests: ['obsidian-compat/request-url.test.ts'],
    notes: 'Network requests are limited to http/https, size-limited, timeout-limited, and local/private hosts are blocked.',
  },
  {
    api: 'FileSystemAdapter',
    surface: 'core',
    support: 'limited',
    host: 'Native adapter guard',
    tests: ['obsidian-compat/integration.test.ts', 'obsidian-compat/compatibility-report.test.ts'],
    notes: 'MindOS exports the class for instanceof guards, but does not expose native filesystem base paths to community plugins.',
  },
];

const CAPABILITY_BY_API = new Map(OBSIDIAN_CAPABILITY_MATRIX.map((row) => [row.api, row]));

export function getObsidianCapability(api: string): ObsidianCapabilityRow | undefined {
  return CAPABILITY_BY_API.get(api);
}

export function isFullySupportedObsidianApi(api: string): boolean {
  return getObsidianCapability(api)?.support === 'full';
}

export function isPartiallySupportedObsidianApi(api: string): boolean {
  const support = getObsidianCapability(api)?.support;
  return support === 'limited'
    || support === 'snapshot-only'
    || support === 'catalog-only'
    || support === 'request-only';
}

export function isUnsupportedObsidianApi(api: string): boolean {
  const row = getObsidianCapability(api);
  return !row || row.support === 'unsupported';
}

export function buildObsidianCapabilityCoverage(
  report: ObsidianCapabilityReportLike,
): ObsidianCapabilityCoverage[] {
  return Array.from(new Set(report.obsidianApis)).sort().map((api) => {
    const row = getObsidianCapability(api);
    if (row) {
      return {
        api: row.api,
        surface: row.surface,
        support: row.support,
        host: row.host,
        ...(row.route ? { route: row.route } : {}),
        notes: row.notes,
      };
    }
    return {
      api,
      surface: 'unsupported',
      support: 'unsupported',
      host: 'Unsupported Obsidian API',
      notes: 'MindOS does not currently expose this Obsidian API.',
    };
  });
}

export function summarizeObsidianCapabilityCoverage(
  coverage: ObsidianCapabilityCoverage[],
): Record<ObsidianCapabilitySupport, number> {
  return coverage.reduce<Record<ObsidianCapabilitySupport, number>>((summary, item) => {
    summary[item.support] += 1;
    return summary;
  }, emptySupportSummary());
}

export function summarizeObsidianCapabilitySurfaces(
  coverage: ObsidianCapabilityCoverage[],
): ObsidianCapabilitySurfaceSummary[] {
  const bySurface = new Map<ObsidianCapabilitySurface, ObsidianCapabilitySurfaceSummary>();

  for (const item of coverage) {
    const summary = bySurface.get(item.surface) ?? {
      surface: item.surface,
      apiCount: 0,
      supportSummary: emptySupportSummary(),
      apis: [],
      hosts: [],
      routes: [],
    };
    summary.apiCount += 1;
    summary.supportSummary[item.support] += 1;
    summary.apis.push(item.api);
    if (!summary.hosts.includes(item.host)) {
      summary.hosts.push(item.host);
    }
    if (item.route && !summary.routes.includes(item.route)) {
      summary.routes.push(item.route);
    }
    bySurface.set(item.surface, summary);
  }

  return Array.from(bySurface.values())
    .map((summary) => ({
      ...summary,
      apis: summary.apis.sort((a, b) => a.localeCompare(b, 'en')),
      hosts: summary.hosts.sort((a, b) => a.localeCompare(b, 'en')),
      routes: summary.routes.sort((a, b) => a.localeCompare(b, 'en')),
    }))
    .sort((a, b) => {
      const orderA = SURFACE_ORDER.indexOf(a.surface);
      const orderB = SURFACE_ORDER.indexOf(b.surface);
      return (orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA)
        - (orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB)
        || a.surface.localeCompare(b.surface, 'en');
    });
}
