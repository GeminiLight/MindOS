import fs from 'fs';
import path from 'path';
import {
  buildObsidianCapabilityCoverage,
  summarizeObsidianCapabilitySurfaces,
  type ObsidianCapabilityCoverage,
  type ObsidianCapabilitySupport,
  type ObsidianCapabilitySurface,
} from './capability-matrix';
import {
  getObsidianImportSupport,
  type ObsidianImportSupport,
  type ObsidianImportSupportKind,
} from './import-policy';
import {
  OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH,
} from './plugin-paths';
import {
  OBSIDIAN_LINTER_PLUGIN_ID,
  parseImportedObsidianLinterProfileJson,
} from './linter-settings-profile';
import {
  parseImportedQuickAddChoiceInventoryJson,
  type ImportedQuickAddChoiceInventory,
} from './quickadd-choice-inventory';
import type { ScannedObsidianPlugin } from './obsidian-import';
import type { ObsidianCapabilityGateReport } from './capability-gate';

export type ObsidianCompatibilityPreviewSource =
  | 'static-analysis'
  | 'obsidian-config'
  | 'plugin-data'
  | 'runtime-ledger';

export interface ObsidianCompatibilityPreviewPackagePath {
  sourcePath: string;
  targetPath: string;
  copiedFiles: string[];
  sourceVaultUnchanged: boolean;
  enableAfterImport: boolean;
}

export interface ObsidianCompatibilityPreviewSettingsMapping {
  id: string;
  label: string;
  source: 'data.json' | 'hotkeys.json' | 'community-plugins.json';
  mappedItems: string[];
  ignoredItems: string[];
  warnings: string[];
  appliedOnImport: boolean;
}

export type ObsidianWorkflowOutcomeStatus =
  | 'available'
  | 'limited'
  | 'preview-only'
  | 'not-available'
  | 'native-replacement';

export interface ObsidianWorkflowOutcome {
  id: string;
  label: string;
  status: ObsidianWorkflowOutcomeStatus;
  evidence: string[];
  nextStep?: string;
}

export type ObsidianSurfaceCatalogStatus =
  | 'ready'
  | 'limited'
  | 'preview-only'
  | 'catalog-only'
  | 'request-only'
  | 'native-gated'
  | 'blocked';

export interface ObsidianSurfaceCatalogEntry {
  surface: ObsidianCapabilitySurface;
  label: string;
  status: ObsidianSurfaceCatalogStatus;
  source: 'static-analysis';
  apiCount: number;
  apis: string[];
  hosts: string[];
  routes: string[];
  supportSummary: Record<ObsidianCapabilitySupport, number>;
  summary: string;
  limitations: string[];
  nextStep: string;
}

export type ObsidianRuntimeCapabilityLedgerPhase =
  | 'predicted'
  | 'registered'
  | 'called'
  | 'blocked';

export interface ObsidianRuntimeCapabilityLedgerEntry {
  pluginId?: string;
  capability: string;
  surface: ObsidianCapabilitySurface;
  support: ObsidianCapabilitySupport;
  phase: ObsidianRuntimeCapabilityLedgerPhase;
  source: ObsidianCompatibilityPreviewSource;
  evidence: string;
}

export interface ObsidianCompatibilityPreview {
  schemaVersion: 1;
  pluginId: string;
  packagePath: ObsidianCompatibilityPreviewPackagePath;
  supportKind: ObsidianImportSupportKind;
  blockedReasons: string[];
  warnings: string[];
  settingsMappings: ObsidianCompatibilityPreviewSettingsMapping[];
  surfaceCatalog: ObsidianSurfaceCatalogEntry[];
  workflowOutcomes: ObsidianWorkflowOutcome[];
  runtimeCapabilityLedger: ObsidianRuntimeCapabilityLedgerEntry[];
  nextSteps: string[];
}

export interface BuildObsidianCompatibilityPreviewOptions {
  sourcePluginsPath: string;
  targetPluginsRootPath?: string;
  hasEnabledList?: boolean;
  support?: ObsidianImportSupport;
  coverage?: ObsidianCapabilityCoverage[];
}

export function buildObsidianCompatibilityPreview(
  plugin: ScannedObsidianPlugin,
  options: BuildObsidianCompatibilityPreviewOptions,
): ObsidianCompatibilityPreview {
  const support = options.support ?? getObsidianImportSupport(plugin, { hasEnabledList: options.hasEnabledList });
  const coverage = options.coverage ?? buildObsidianCapabilityCoverage(plugin.compatibility);
  const packagePath = buildPackagePath(plugin, options);
  const settingsMappings = buildSettingsMappings(plugin);
  const blockedReasons = buildBlockedReasons(plugin, support);
  const surfaceCatalog = buildSurfaceCatalog(plugin, coverage);
  const workflowOutcomes = buildWorkflowOutcomes(plugin, support, coverage, settingsMappings);
  const runtimeCapabilityLedger = buildPredictedRuntimeCapabilityLedger(plugin, coverage);
  const warnings = unique([
    ...settingsMappings.flatMap((mapping) => mapping.warnings),
    ...workflowOutcomes
      .filter((outcome) => outcome.status === 'native-replacement' || outcome.status === 'not-available')
      .map((outcome) => outcome.nextStep)
      .filter((item): item is string => Boolean(item)),
  ]);

  return {
    schemaVersion: 1,
    pluginId: plugin.id,
    packagePath,
    supportKind: support.kind,
    blockedReasons,
    warnings,
    settingsMappings,
    surfaceCatalog,
    workflowOutcomes,
    runtimeCapabilityLedger,
    nextSteps: buildNextSteps(plugin, support, coverage, packagePath, settingsMappings, blockedReasons),
  };
}

export function summarizeObsidianRuntimeCapabilityLedger(
  entries: ObsidianRuntimeCapabilityLedgerEntry[],
): Record<ObsidianRuntimeCapabilityLedgerPhase, number> {
  return entries.reduce<Record<ObsidianRuntimeCapabilityLedgerPhase, number>>((summary, entry) => {
    summary[entry.phase] += 1;
    return summary;
  }, { predicted: 0, registered: 0, called: 0, blocked: 0 });
}

export interface MergeObsidianRuntimeCapabilityLedgerInput {
  pluginId: string;
  coverage: ObsidianCapabilityCoverage[];
  unsupportedModules?: string[];
  capabilityGate?: ObsidianCapabilityGateReport;
  runtimeEntries?: ObsidianRuntimeCapabilityLedgerEntry[];
}

export function buildPredictedObsidianRuntimeCapabilityLedger(
  input: Pick<MergeObsidianRuntimeCapabilityLedgerInput, 'pluginId' | 'coverage' | 'unsupportedModules'>,
): ObsidianRuntimeCapabilityLedgerEntry[] {
  const entries: ObsidianRuntimeCapabilityLedgerEntry[] = input.coverage.map((item) => ({
    pluginId: input.pluginId,
    capability: item.api,
    surface: item.surface,
    support: item.support,
    phase: item.support === 'unsupported' || item.surface === 'unsupported' ? 'blocked' : 'predicted',
    source: 'static-analysis',
    evidence: `main.js static analysis detected Obsidian API "${item.api}".`,
  }));

  for (const moduleName of input.unsupportedModules ?? []) {
    entries.push({
      pluginId: input.pluginId,
      capability: `module:${moduleName}`,
      surface: 'unsupported',
      support: 'unsupported',
      phase: 'blocked',
      source: 'static-analysis',
      evidence: `main.js static analysis detected unsupported runtime module "${moduleName}".`,
    });
  }

  return entries;
}

export function mergeObsidianRuntimeCapabilityLedger(
  input: MergeObsidianRuntimeCapabilityLedgerInput,
): ObsidianRuntimeCapabilityLedgerEntry[] {
  const entries = [
    ...buildPredictedObsidianRuntimeCapabilityLedger(input),
    ...(input.runtimeEntries ?? []),
  ];

  for (const item of input.capabilityGate?.items ?? []) {
    if (item.decision !== 'blocked') continue;
    entries.push({
      pluginId: input.pluginId,
      capability: item.apis.join(', '),
      surface: item.surface,
      support: 'unsupported',
      phase: 'blocked',
      source: 'runtime-ledger',
      evidence: item.reason,
    });
  }

  for (const reason of input.capabilityGate?.blockedReasons ?? []) {
    entries.push({
      pluginId: input.pluginId,
      capability: 'capability-gate',
      surface: 'unsupported',
      support: 'unsupported',
      phase: 'blocked',
      source: 'runtime-ledger',
      evidence: reason,
    });
  }

  return entries;
}

function buildPackagePath(
  plugin: ScannedObsidianPlugin,
  options: BuildObsidianCompatibilityPreviewOptions,
): ObsidianCompatibilityPreviewPackagePath {
  const sourcePluginsPath = trimSlashes(options.sourcePluginsPath || '.obsidian/plugins');
  const targetPluginsRootPath = trimSlashes(options.targetPluginsRootPath ?? OBSIDIAN_PLUGIN_ROOT_RELATIVE_PATH);
  return {
    sourcePath: `${sourcePluginsPath}/${plugin.id}`,
    targetPath: `${targetPluginsRootPath}/${plugin.id}`,
    copiedFiles: copiedFilesFor(plugin),
    sourceVaultUnchanged: true,
    enableAfterImport: false,
  };
}

function copiedFilesFor(plugin: ScannedObsidianPlugin): string[] {
  return [
    'manifest.json',
    'main.js',
    ...(plugin.hasStyles ? ['styles.css'] : []),
    ...(plugin.hasData ? ['data.json'] : []),
    'obsidian-import.json',
  ];
}

function buildSettingsMappings(plugin: ScannedObsidianPlugin): ObsidianCompatibilityPreviewSettingsMapping[] {
  const mappings: ObsidianCompatibilityPreviewSettingsMapping[] = [];

  if (plugin.id === OBSIDIAN_LINTER_PLUGIN_ID && plugin.hasData) {
    const rawDataJson = readRegularPluginFile(plugin.sourceDir, 'data.json');
    if (rawDataJson === null) {
      mappings.push({
        id: 'obsidian-linter-profile',
        label: 'Linter rule profile',
        source: 'data.json',
        mappedItems: [],
        ignoredItems: [],
        warnings: ['Linter data.json is present but could not be read as a regular file.'],
        appliedOnImport: false,
      });
    } else {
      const profile = parseImportedObsidianLinterProfileJson(plugin.id, rawDataJson);
      if (profile) {
        mappings.push({
          id: 'obsidian-linter-profile',
          label: 'Linter rule profile',
          source: 'data.json',
          mappedItems: profile.mappedRules,
          ignoredItems: profile.ignoredRules,
          warnings: profile.warnings,
          appliedOnImport: true,
        });
      } else {
        mappings.push({
          id: 'obsidian-linter-profile',
          label: 'Linter rule profile',
          source: 'data.json',
          mappedItems: [],
          ignoredItems: [],
          warnings: ['No supported Linter rule settings were found in data.json.'],
          appliedOnImport: false,
        });
      }
    }
  }

  if (pluginIdentity(plugin) === 'quickadd' && plugin.hasData) {
    const rawDataJson = readRegularPluginFile(plugin.sourceDir, 'data.json');
    if (rawDataJson === null) {
      mappings.push({
        id: 'quickadd-choice-inventory',
        label: 'QuickAdd choice inventory',
        source: 'data.json',
        mappedItems: [],
        ignoredItems: [],
        warnings: ['QuickAdd data.json is present but could not be read as a regular file.'],
        appliedOnImport: false,
      });
    } else {
      const inventory = parseImportedQuickAddChoiceInventoryJson(plugin.id, rawDataJson);
      if (inventory) {
        mappings.push({
          id: 'quickadd-choice-inventory',
          label: 'QuickAdd choice inventory',
          source: 'data.json',
          mappedItems: inventory.safeSubsetChoices,
          ignoredItems: [
            ...inventory.reviewChoices,
            ...inventory.ignoredChoices,
          ],
          warnings: [
            ...inventory.warnings,
            'QuickAdd choices are copied for review; MindOS does not rewrite or auto-run them during import.',
          ],
          appliedOnImport: false,
        });
      }
    }
  }

  if (plugin.obsidianConfig.hotkeyCount > 0) {
    mappings.push({
      id: 'obsidian-hotkeys',
      label: 'Obsidian hotkeys',
      source: 'hotkeys.json',
      mappedItems: plugin.obsidianConfig.hotkeys.map((item) => item.commandId),
      ignoredItems: [],
      warnings: ['Hotkeys are displayed for migration review; they are not rebound automatically during import.'],
      appliedOnImport: false,
    });
  }

  if (plugin.obsidianConfig.hasEnabledList !== undefined) {
    mappings.push({
      id: 'obsidian-enabled-state',
      label: 'Source enabled state',
      source: 'community-plugins.json',
      mappedItems: plugin.obsidianConfig.enabledInObsidian ? [plugin.id] : [],
      ignoredItems: plugin.obsidianConfig.enabledInObsidian ? [] : [plugin.id],
      warnings: ['Source enabled state only affects default selection; imported plugins remain disabled until enabled in MindOS.'],
      appliedOnImport: false,
    });
  }

  return mappings;
}

function readRegularPluginFile(pluginDir: string, fileName: string): string | null {
  try {
    const filePath = path.join(pluginDir, fileName);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function buildBlockedReasons(plugin: ScannedObsidianPlugin, support: ObsidianImportSupport): string[] {
  const reasons = [
    ...(support.kind === 'blocked' ? [support.reason] : []),
    ...plugin.compatibility.blockers,
    ...(plugin.compatibility.unsupportedApis.length > 0
      ? [`Unsupported Obsidian APIs: ${plugin.compatibility.unsupportedApis.join(', ')}`]
      : []),
    ...(plugin.compatibility.unsupportedModules.length > 0
      ? [`Unsupported runtime modules: ${plugin.compatibility.unsupportedModules.join(', ')}`]
      : []),
  ];
  return unique(reasons);
}

function buildSurfaceCatalog(
  plugin: ScannedObsidianPlugin,
  coverage: ObsidianCapabilityCoverage[],
): ObsidianSurfaceCatalogEntry[] {
  const entries = summarizeObsidianCapabilitySurfaces(coverage).map((summary) => {
    const status = surfaceCatalogStatus(summary.surface, summary.supportSummary);
    return {
      surface: summary.surface,
      label: surfaceCatalogLabel(summary.surface),
      status,
      source: 'static-analysis' as const,
      apiCount: summary.apiCount,
      apis: summary.apis,
      hosts: summary.hosts,
      routes: summary.routes,
      supportSummary: summary.supportSummary,
      summary: surfaceCatalogSummary(summary.surface, status),
      limitations: surfaceCatalogLimitations(summary.surface, status, summary.supportSummary),
      nextStep: surfaceCatalogNextStep(summary.surface, status),
    };
  });

  if (plugin.compatibility.unsupportedModules.length > 0) {
    const unsupportedEntry = entries.find((entry) => entry.surface === 'unsupported');
    const moduleApis = plugin.compatibility.unsupportedModules.map((moduleName) => `module:${moduleName}`);
    if (unsupportedEntry) {
      unsupportedEntry.apis = unique([...unsupportedEntry.apis, ...moduleApis]).sort((a, b) => a.localeCompare(b, 'en'));
      unsupportedEntry.hosts = unique([...unsupportedEntry.hosts, 'Unsupported runtime module']).sort((a, b) => a.localeCompare(b, 'en'));
      unsupportedEntry.apiCount = unsupportedEntry.apis.length;
      unsupportedEntry.supportSummary.unsupported += moduleApis.length;
      unsupportedEntry.limitations = unique([
        ...unsupportedEntry.limitations,
        `Unsupported runtime modules: ${plugin.compatibility.unsupportedModules.join(', ')}.`,
      ]);
    } else {
      entries.push({
        surface: 'unsupported',
        label: surfaceCatalogLabel('unsupported'),
        status: 'blocked',
        source: 'static-analysis',
        apiCount: moduleApis.length,
        apis: moduleApis,
        hosts: ['Unsupported runtime module'],
        routes: [],
        supportSummary: {
          full: 0,
          limited: 0,
          'snapshot-only': 0,
          'catalog-only': 0,
          'request-only': 0,
          unsupported: moduleApis.length,
        },
        summary: surfaceCatalogSummary('unsupported', 'blocked'),
        limitations: [`Unsupported runtime modules: ${plugin.compatibility.unsupportedModules.join(', ')}.`],
        nextStep: surfaceCatalogNextStep('unsupported', 'blocked'),
      });
    }
  }

  return entries;
}

function surfaceCatalogStatus(
  surface: ObsidianCapabilitySurface,
  supportSummary: Record<ObsidianCapabilitySupport, number>,
): ObsidianSurfaceCatalogStatus {
  if (surface === 'unsupported' || supportSummary.unsupported > 0) return 'blocked';
  if (surface === 'editor') return 'native-gated';
  if (supportSummary['snapshot-only'] > 0) return 'preview-only';
  if (
    supportSummary['catalog-only'] > 0
    && supportSummary.full === 0
    && supportSummary.limited === 0
    && supportSummary['request-only'] === 0
  ) {
    return 'catalog-only';
  }
  if (
    supportSummary['request-only'] > 0
    && supportSummary.full === 0
    && supportSummary.limited === 0
    && supportSummary['catalog-only'] === 0
  ) {
    return 'request-only';
  }
  if (supportSummary.limited > 0 || supportSummary['catalog-only'] > 0 || supportSummary['request-only'] > 0) {
    return 'limited';
  }
  return 'ready';
}

function surfaceCatalogLabel(surface: ObsidianCapabilitySurface): string {
  return {
    commands: 'Commands',
    settings: 'Settings',
    entries: 'Entries',
    views: 'Views',
    document: 'Document',
    styles: 'Styles',
    editor: 'Editor',
    secret: 'Secrets',
    vault: 'Vault',
    metadata: 'Metadata',
    workspace: 'Workspace',
    network: 'Network',
    core: 'Core runtime',
    unsupported: 'Blocked capability',
  }[surface];
}

function surfaceCatalogSummary(
  surface: ObsidianCapabilitySurface,
  status: ObsidianSurfaceCatalogStatus,
): string {
  if (status === 'blocked') return 'Static analysis found APIs or runtime modules that the generic MindOS Obsidian host does not expose.';
  return {
    commands: 'Command registrations map to MindOS Command Center.',
    settings: 'Settings APIs map to MindOS plugin settings host or settings catalog.',
    entries: 'Ribbon, status, modal, menu, notice, and suggest entrypoints are captured as bounded plugin entries.',
    views: 'View APIs are cataloged or exposed through MindOS compatibility view hosts.',
    document: 'Markdown renderer and document helpers map to safe document snapshot paths.',
    styles: 'Style APIs are scoped to compatibility hosts instead of mutating global Obsidian chrome.',
    editor: 'Editor and CodeMirror APIs are cataloged, but live editor mounting stays behind native adapter gates.',
    secret: 'Secret APIs map to the MindOS plugin secret vault.',
    vault: 'Vault and file APIs are scoped to MindOS local content with private directories hidden.',
    metadata: 'Metadata APIs read MindOS parsed markdown, frontmatter, tag, and link caches.',
    workspace: 'Workspace requests and selected events are recorded or explicitly triggered by MindOS.',
    network: 'Network APIs route through the restricted request host.',
    core: 'Core lifecycle and utility APIs run inside the restricted compatibility host.',
    unsupported: 'Static analysis found APIs or runtime modules that the generic MindOS Obsidian host does not expose.',
  }[surface];
}

function surfaceCatalogLimitations(
  surface: ObsidianCapabilitySurface,
  status: ObsidianSurfaceCatalogStatus,
  supportSummary: Record<ObsidianCapabilitySupport, number>,
): string[] {
  const limitations: string[] = [];
  if (status === 'preview-only') {
    limitations.push('Snapshot evidence is reviewable, but it is not equivalent to native Obsidian UI behavior.');
  }
  if (status === 'catalog-only') {
    limitations.push('Cataloged registrations are visible for planning, but MindOS does not mount the live behavior yet.');
  }
  if (status === 'request-only') {
    limitations.push('Requests are recorded for MindOS handling; full Obsidian workspace side effects are not replayed.');
  }
  if (status === 'native-gated') {
    limitations.push('Live editor or CodeMirror integration requires a MindOS native adapter before it can be treated as runnable.');
  }
  if (status === 'limited') {
    limitations.push('Limited APIs require capability review and focused workflow verification before relying on them.');
  }
  if (status === 'blocked') {
    limitations.push('Blocked APIs or modules prevent generic runtime execution until replaced or explicitly supported.');
  }
  if (surface === 'vault') {
    limitations.push('Vault access remains scoped to public MindOS content; private plugin and system directories stay hidden.');
  }
  if (surface === 'network') {
    limitations.push('Outbound requests are limited by protocol, host, timeout, and size policy.');
  }
  if (surface === 'settings' && supportSummary['catalog-only'] > 0) {
    limitations.push('Declarative or custom settings may be visible before every control becomes editable.');
  }
  if (surface === 'views') {
    limitations.push('MindOS does not emulate the full Obsidian pane layout graph.');
  }
  return unique(limitations);
}

function surfaceCatalogNextStep(
  surface: ObsidianCapabilitySurface,
  status: ObsidianSurfaceCatalogStatus,
): string {
  if (status === 'ready') return 'Enable the plugin and verify registered behavior in the corresponding MindOS surface.';
  if (status === 'preview-only') return 'Inspect the snapshot output and run workflow probes before treating it as observed.';
  if (status === 'catalog-only') return 'Use the catalog for migration planning, then add a MindOS adapter before relying on live behavior.';
  if (status === 'request-only') return 'Confirm the recorded request is handled by a MindOS-native surface or workflow.';
  if (status === 'native-gated') return 'Route this behavior through a MindOS native adapter instead of raw community plugin mounting.';
  if (status === 'blocked') return 'Do not import or enable until blocked capabilities are replaced or explicitly supported.';
  if (surface === 'network') return 'Review the network capability gate and verify allowed outbound hosts during enable/load.';
  if (surface === 'vault' || surface === 'metadata') return 'Review vault and metadata capability prompts before enabling write or index workflows.';
  return 'Review capability prompts and run focused smoke or workflow probes after enable/load.';
}

function buildWorkflowOutcomes(
  plugin: ScannedObsidianPlugin,
  support: ObsidianImportSupport,
  coverage: ObsidianCapabilityCoverage[],
  settingsMappings: ObsidianCompatibilityPreviewSettingsMapping[],
): ObsidianWorkflowOutcome[] {
  const outcomes: ObsidianWorkflowOutcome[] = [];
  const blocked = support.kind === 'blocked';
  const identity = pluginIdentity(plugin);

  if (identity === 'linter') {
    outcomes.push({
      id: 'linter-markdown-source-editor',
      label: 'Lint Markdown in the source editor',
      status: blocked ? 'not-available' : 'available',
      evidence: [
        'MindOS uses its own Linter adapter and explicit review/apply/undo flow.',
        settingsMappings.some((mapping) => mapping.id === 'obsidian-linter-profile' && mapping.mappedItems.length > 0)
          ? 'Obsidian Linter data.json has importable rule settings.'
          : 'No importable Linter rule settings were detected.',
      ],
      nextStep: blocked ? 'Resolve blocked capabilities before enabling Linter workflows.' : 'Import, then open a Markdown source editor and use Lint preview.',
    });
  }

  if (identity === 'quickadd') {
    const quickAddInventory = readQuickAddChoiceInventory(plugin);
    const quickAddOutcomes = buildQuickAddChoiceOutcomes(plugin, blocked, coverage, quickAddInventory);
    outcomes.push(...quickAddOutcomes);
  }

  if (identity === 'templater') {
    outcomes.push({
      id: 'templater-runtime-gate',
      label: 'Run dynamic Templater scripts',
      status: blocked ? 'not-available' : 'native-replacement',
      evidence: [
        'Official Templater runtime depends on editor and scripting capabilities that must stay behind explicit gates.',
        plugin.compatibility.unsupportedModules.length > 0
          ? `Current blockers: ${plugin.compatibility.unsupportedModules.join(', ')}.`
          : 'No safe Templater script execution subset has been proven yet.',
      ],
      nextStep: 'Use QuickAdd Template choice migration for the safe template-note subset; keep official Templater behind CodeMirror/native/script gates.',
    });
  }

  if (identity === 'tag-wrangler') {
    outcomes.push({
      id: 'tag-wrangler-metadata-management',
      label: 'Inspect and update tag metadata',
      status: blocked ? 'not-available' : 'limited',
      evidence: [
        hasAnySurface(coverage, ['metadata', 'vault']) ? 'Metadata and vault APIs are routed through scoped MindOS hosts.' : 'No metadata/vault surface was detected.',
      ],
      nextStep: blocked ? 'Prefer MindOS native tag management until blockers are resolved.' : 'Import only after reviewing vault and metadata capability prompts.',
    });
  }

  if (identity === 'calendar') {
    outcomes.push({
      id: 'calendar-periodic-note-navigation',
      label: 'Navigate periodic notes from a calendar view',
      status: blocked ? 'not-available' : 'limited',
      evidence: [
        hasAnySurface(coverage, ['views', 'workspace', 'commands']) ? 'Views, workspace requests, or command registrations were detected.' : 'No view/navigation surface was detected.',
      ],
      nextStep: blocked ? 'Use MindOS native calendar/periodic-note surfaces instead.' : 'Import, enable, then verify the view and note-open requests in MindOS.',
    });
  }

  if (identity === 'admonition') {
    outcomes.push({
      id: 'admonition-document-rendering',
      label: 'Render admonition and callout-like Markdown blocks',
      status: blocked ? 'native-replacement' : 'preview-only',
      evidence: [
        hasSurface(coverage, 'document') ? 'Markdown renderer/post-processor APIs map to safe document snapshot hosts.' : 'No document rendering surface was detected.',
      ],
      nextStep: 'Prefer MindOS native callout/admonition rendering for long-term compatibility.',
    });
  }

  outcomes.push(...buildNativeReplacementOutcomes(plugin, coverage));

  if (!blocked) {
    outcomes.push(...buildGenericSurfaceOutcomes(coverage));
  }

  if (!blocked && hasSurface(coverage, 'network')) {
    outcomes.push({
      id: 'network-review',
      label: 'Use restricted outbound requests',
      status: 'limited',
      evidence: ['Network APIs map to the restricted request/requestUrl host.'],
      nextStep: 'Confirm network capability during enable/load if this plugin still needs outbound requests.',
    });
  }

  return dedupeOutcomes(outcomes);
}

function buildNativeReplacementOutcomes(
  plugin: ScannedObsidianPlugin,
  coverage: ObsidianCapabilityCoverage[],
): ObsidianWorkflowOutcome[] {
  const outcomes: ObsidianWorkflowOutcome[] = [];
  const identity = pluginIdentity(plugin);

  if (identity === 'dataview' || identity === 'tasks' || /query|task/i.test(plugin.manifest.name)) {
    outcomes.push({
      id: 'native-query-index-replacement',
      label: 'Use MindOS native query and index workflows',
      status: 'native-replacement',
      evidence: ['Query/task plugins depend on deep index semantics that should be productized in MindOS instead of shimmed as arbitrary runtime code.'],
      nextStep: 'Route Dataview/Tasks-style workflows to MindOS native query, retrieval, and task surfaces.',
    });
  }

  if (
    hasSurface(coverage, 'editor')
    || plugin.compatibility.unsupportedModules.some((moduleName) => /codemirror/i.test(moduleName))
  ) {
    outcomes.push({
      id: 'editor-native-adapter',
      label: 'Use MindOS native editor adapters',
      status: 'native-replacement',
      evidence: ['Editor and CodeMirror integrations are cataloged but not auto-mounted into the live editor.'],
      nextStep: 'Use MindOS native editor adapters for editor-heavy behavior; raw CodeMirror extensions are not auto-mounted.',
    });
  }

  if (plugin.compatibility.unsupportedModules.some(isNativeOrSyncModule)) {
    outcomes.push({
      id: 'desktop-broker-native-replacement',
      label: 'Use a Desktop broker or MindOS-native capability',
      status: 'native-replacement',
      evidence: ['Native/Electron/Node modules are blocked from the generic community plugin runtime.'],
      nextStep: 'Implement native/git/sync behavior through a narrow Desktop broker or MindOS-owned integration.',
    });
  }

  return outcomes;
}

function buildQuickAddChoiceOutcomes(
  plugin: ScannedObsidianPlugin,
  blocked: boolean,
  coverage: ObsidianCapabilityCoverage[],
  inventory: ImportedQuickAddChoiceInventory | null,
): ObsidianWorkflowOutcome[] {
  const outcomes: ObsidianWorkflowOutcome[] = [];
  const safeChoices = inventory?.choices.filter((choice) => choice.support === 'safe-subset') ?? [];
  const captureChoices = safeChoices.filter((choice) => choice.kind === 'capture');
  const templateChoices = safeChoices.filter((choice) => choice.kind === 'template');

  if (captureChoices.length > 0) {
    outcomes.push({
      id: 'quickadd-capture-choice',
      label: 'Run data.json Capture choices',
      status: blocked ? 'not-available' : 'limited',
      evidence: [
        `Detected ${captureChoices.length} command-enabled Capture choice${captureChoices.length === 1 ? '' : 's'} in QuickAdd data.json.`,
        ...captureChoices.slice(0, 3).map((choice) => choice.summary),
      ],
      nextStep: blocked
        ? 'Use MindOS workflows instead of this blocked package.'
        : 'Import, enable after capability review, then run workflow probes before treating capture workflows as observed.',
    });
  }

  if (templateChoices.length > 0) {
    outcomes.push({
      id: 'quickadd-template-choice',
      label: 'Create notes from data.json Template choices',
      status: blocked ? 'not-available' : 'limited',
      evidence: [
        `Detected ${templateChoices.length} command-enabled Template choice${templateChoices.length === 1 ? '' : 's'} in QuickAdd data.json.`,
        ...templateChoices.slice(0, 3).map((choice) => choice.summary),
      ],
      nextStep: blocked
        ? 'Use MindOS-native templates instead of this blocked package.'
        : 'Import, enable after capability review, then verify each template choice; dynamic filename tokens, prompts, scripts, and Templater integrations still require review.',
    });
  }

  if (outcomes.length > 0) {
    return outcomes;
  }

  return [{
    id: 'quickadd-command-capture',
    label: 'Run QuickAdd command entries',
    status: blocked ? 'not-available' : 'limited',
    evidence: [
      hasSurface(coverage, 'commands') ? 'Command registration maps to MindOS Command Center.' : 'No command surface was detected.',
      hasSurface(coverage, 'entries') ? 'Modal and suggest flows are exposed as bounded review snapshots.' : 'No modal/suggest entry surface was detected.',
      inventory && inventory.choices.length === 0 ? 'No supported Capture or Template choices were found in QuickAdd data.json.' : '',
    ],
    nextStep: blocked ? 'Use MindOS workflows instead of this blocked package.' : 'Import, enable after capability review, then test each capture/macro command.',
  }];
}

function buildGenericSurfaceOutcomes(coverage: ObsidianCapabilityCoverage[]): ObsidianWorkflowOutcome[] {
  const outcomes: ObsidianWorkflowOutcome[] = [];

  if (hasSurface(coverage, 'commands')) {
    outcomes.push({
      id: 'generic-plugin-commands',
      label: 'Run plugin commands',
      status: 'available',
      evidence: ['Command APIs map to MindOS Command Center.'],
      nextStep: 'Enable the plugin, then run commands from Command Center.',
    });
  }

  if (hasSurface(coverage, 'settings')) {
    outcomes.push({
      id: 'generic-plugin-settings',
      label: 'Review plugin settings',
      status: 'available',
      evidence: ['Settings APIs map to the MindOS plugin settings host.'],
      nextStep: 'Open Installed plugin settings after import.',
    });
  }

  if (hasSurface(coverage, 'views')) {
    outcomes.push({
      id: 'generic-plugin-views',
      label: 'Open plugin views',
      status: 'limited',
      evidence: ['View APIs map to compatibility leaves and snapshot hosts.'],
      nextStep: 'Verify view output after enable/load; full Obsidian pane layout is not emulated.',
    });
  }

  if (hasSurface(coverage, 'document')) {
    outcomes.push({
      id: 'generic-document-contributions',
      label: 'Preview document contributions',
      status: 'preview-only',
      evidence: ['Markdown renderer/post-processor APIs map to safe document snapshot hosts.'],
      nextStep: 'Verify rendered document snapshots before relying on plugin output.',
    });
  }

  if (hasAnySurface(coverage, ['vault', 'metadata'])) {
    outcomes.push({
      id: 'generic-vault-metadata',
      label: 'Use scoped vault and metadata APIs',
      status: 'limited',
      evidence: ['Vault and metadata APIs are scoped to MindOS local content and private directories are hidden.'],
      nextStep: 'Review vault/metadata capability prompts before enabling.',
    });
  }

  return outcomes;
}

function buildPredictedRuntimeCapabilityLedger(
  plugin: ScannedObsidianPlugin,
  coverage: ObsidianCapabilityCoverage[],
): ObsidianRuntimeCapabilityLedgerEntry[] {
  return buildPredictedObsidianRuntimeCapabilityLedger({
    pluginId: plugin.id,
    coverage,
    unsupportedModules: plugin.compatibility.unsupportedModules,
  });
}

function buildNextSteps(
  plugin: ScannedObsidianPlugin,
  support: ObsidianImportSupport,
  coverage: ObsidianCapabilityCoverage[],
  packagePath: ObsidianCompatibilityPreviewPackagePath,
  settingsMappings: ObsidianCompatibilityPreviewSettingsMapping[],
  blockedReasons: string[],
): string[] {
  const steps: string[] = [];

  if (blockedReasons.length > 0 || support.kind === 'blocked') {
    steps.push('Do not import until blocked capabilities are replaced or explicitly supported.');
    for (const reason of blockedReasons.slice(0, 3)) {
      steps.push(`Resolve blocker: ${reason}`);
    }
  } else {
    steps.push(`Import package into ${packagePath.targetPath}.`);
    steps.push('Enable from Installed after reviewing capability gate prompts.');
  }

  if (settingsMappings.some((mapping) => mapping.id === 'obsidian-linter-profile' && mapping.appliedOnImport)) {
    steps.push('Review mapped Linter settings before enabling source-editor linting.');
  }

  if (settingsMappings.some((mapping) => mapping.id === 'quickadd-choice-inventory' && mapping.mappedItems.length > 0)) {
    steps.push('Review imported QuickAdd choices, then run workflow probes before treating Capture or Template choices as observed.');
  }

  if (hasSurface(coverage, 'network')) {
    steps.push('Confirm network capability during enable/load if this plugin still needs outbound requests.');
  }

  if (hasAnySurface(coverage, ['vault', 'metadata'])) {
    steps.push('Confirm vault and metadata access before enabling workflows that can read or modify notes.');
  }

  if (hasSurface(coverage, 'secret')) {
    steps.push('Confirm secret capability and verify secret values stay in the encrypted MindOS secret backend.');
  }

  if (hasSurface(coverage, 'editor')) {
    steps.push('Use MindOS native editor adapters for editor-heavy behavior; raw CodeMirror extensions are not auto-mounted.');
  }

  return unique(steps);
}

function pluginIdentity(plugin: ScannedObsidianPlugin): 'linter' | 'quickadd' | 'templater' | 'tag-wrangler' | 'calendar' | 'admonition' | 'dataview' | 'tasks' | 'unknown' {
  const id = plugin.id.toLowerCase();
  const name = plugin.manifest.name.toLowerCase();
  if (id === OBSIDIAN_LINTER_PLUGIN_ID || name === 'linter') return 'linter';
  if (id === 'quickadd' || id.includes('quickadd') || name.includes('quickadd')) return 'quickadd';
  if (id === 'templater-obsidian' || id.includes('templater') || name.includes('templater')) return 'templater';
  if (id === 'tag-wrangler' || name.includes('tag wrangler')) return 'tag-wrangler';
  if (id === 'calendar' || name === 'calendar' || name.includes('calendar')) return 'calendar';
  if (id === 'obsidian-admonition' || id.includes('admonition') || name.includes('admonition')) return 'admonition';
  if (id === 'dataview' || name.includes('dataview')) return 'dataview';
  if (id === 'obsidian-tasks-plugin' || id === 'tasks' || name === 'tasks') return 'tasks';
  return 'unknown';
}

function hasSurface(coverage: ObsidianCapabilityCoverage[], surface: ObsidianCapabilitySurface): boolean {
  return coverage.some((item) => item.surface === surface);
}

function hasAnySurface(coverage: ObsidianCapabilityCoverage[], surfaces: ObsidianCapabilitySurface[]): boolean {
  return coverage.some((item) => surfaces.includes(item.surface));
}

function isNativeOrSyncModule(moduleName: string): boolean {
  return /^(electron|node:electron|child_process|node:child_process|fs|node:fs|net|node:net|tls|node:tls)$/u.test(moduleName);
}

function readQuickAddChoiceInventory(plugin: ScannedObsidianPlugin): ImportedQuickAddChoiceInventory | null {
  if (!plugin.hasData) return null;
  const rawDataJson = readRegularPluginFile(plugin.sourceDir, 'data.json');
  return rawDataJson === null ? null : parseImportedQuickAddChoiceInventoryJson(plugin.id, rawDataJson);
}

function dedupeOutcomes(outcomes: ObsidianWorkflowOutcome[]): ObsidianWorkflowOutcome[] {
  const seen = new Set<string>();
  const result: ObsidianWorkflowOutcome[] = [];
  for (const outcome of outcomes) {
    if (seen.has(outcome.id)) continue;
    seen.add(outcome.id);
    result.push({
      ...outcome,
      evidence: unique(outcome.evidence),
    });
  }
  return result;
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function trimSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
