import fs from 'fs';
import path from 'path';
import type { PluginActionResult, PluginRuntimeContext, PluginViewContext } from './plugin-manager';
import type { ManagedPluginMarkdownPostProcessorSnapshot } from './plugin-manager';
import type { ObsidianWorkflowAudit } from './workflow-audit';
import { redactRuntimeCapabilityEvidence } from './runtime-capability-ledger-store';
import { resolveCanonicalPluginWorkflowProbePath } from './plugin-paths';

export const OBSIDIAN_WORKFLOW_PROBE_SCHEMA_VERSION = 1;
export const DEFAULT_OBSIDIAN_WORKFLOW_PROBE_MAX_ENTRIES = 100;
export const DEFAULT_OBSIDIAN_WORKFLOW_PROBE_READ_LIMIT = 50;

export type ObsidianWorkflowProbeId =
  | 'quickadd-capture-macro'
  | 'calendar-open-periodic-note'
  | 'tag-wrangler-rename'
  | 'linter-review-apply'
  | 'admonition-render-markdown';

export type ObsidianWorkflowProbeStatus = 'passed' | 'failed' | 'skipped';
export type ObsidianWorkflowProbeSource = 'workflow-probe';

export interface ObsidianWorkflowProbeAssertion {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface ObsidianWorkflowProbeResult {
  schemaVersion: typeof OBSIDIAN_WORKFLOW_PROBE_SCHEMA_VERSION;
  pluginId: string;
  id: ObsidianWorkflowProbeId;
  label: string;
  status: ObsidianWorkflowProbeStatus;
  source: ObsidianWorkflowProbeSource;
  startedAt: string;
  completedAt: string;
  evidence: string[];
  assertions: ObsidianWorkflowProbeAssertion[];
  failureReason?: string;
}

export interface ObsidianWorkflowProbeHistory {
  total: number;
  entries: ObsidianWorkflowProbeResult[];
  latestById: Partial<Record<ObsidianWorkflowProbeId, ObsidianWorkflowProbeResult>>;
  updatedAt?: string;
  skippedCorruptLines: number;
}

export interface ObsidianWorkflowProbeStoreOptions {
  now?: () => Date;
  maxEntriesPerPlugin?: number;
  defaultReadLimit?: number;
}

export interface ObsidianWorkflowProbeCommand {
  id: string;
  fullId: string;
  name: string;
  executable?: boolean;
  requiresEditor?: boolean;
}

export interface ObsidianWorkflowProbeRuntime {
  commandList: ObsidianWorkflowProbeCommand[];
  viewList?: Array<{ type: string }>;
  markdownPostProcessors: number;
  markdownCodeBlockProcessors: number;
  markdownCodeBlockLanguages?: string[];
  capabilityLedger?: Array<{
    capability: string;
    phase: string;
    evidence: string;
  }>;
}

export interface ObsidianWorkflowProbePlugin {
  id: string;
  name: string;
  loaded: boolean;
  runtime: ObsidianWorkflowProbeRuntime;
}

export interface ObsidianWorkflowProbeHost {
  list(context?: PluginRuntimeContext): ObsidianWorkflowProbePlugin[];
  executeCommand(commandId: string, context?: PluginRuntimeContext): Promise<PluginActionResult>;
  renderView(pluginId: string, viewType: string, context?: PluginViewContext): Promise<{ text?: string; displayText?: string }>;
  renderMarkdownPostProcessors(markdown: string, sourcePath?: string): Promise<ManagedPluginMarkdownPostProcessorSnapshot[]>;
}

export interface RunObsidianWorkflowProbeInput {
  mindRoot: string;
  host: ObsidianWorkflowProbeHost;
  pluginId: string;
  probeId?: ObsidianWorkflowProbeId;
  now?: () => Date;
}

interface WorkflowProbeDefinition {
  id: ObsidianWorkflowProbeId;
  label: string;
  pluginIds: Set<string>;
  run: (input: WorkflowProbeRuntimeInput) => Promise<WorkflowProbeDraft>;
}

interface WorkflowProbeRuntimeInput {
  mindRoot: string;
  host: ObsidianWorkflowProbeHost;
  plugin: ObsidianWorkflowProbePlugin;
}

interface WorkflowProbeDraft {
  status: ObsidianWorkflowProbeStatus;
  evidence: string[];
  assertions: ObsidianWorkflowProbeAssertion[];
  failureReason?: string;
}

interface VaultSnapshot {
  files: Map<string, { size: number; mtimeMs: number }>;
}

export class ObsidianWorkflowProbeStore {
  private readonly maxEntriesPerPlugin: number;
  private readonly defaultReadLimit: number;
  private readonly now: () => Date;

  constructor(
    private readonly mindRoot: string,
    options: ObsidianWorkflowProbeStoreOptions = {},
  ) {
    this.maxEntriesPerPlugin = Math.max(1, options.maxEntriesPerPlugin ?? DEFAULT_OBSIDIAN_WORKFLOW_PROBE_MAX_ENTRIES);
    this.defaultReadLimit = Math.max(1, options.defaultReadLimit ?? DEFAULT_OBSIDIAN_WORKFLOW_PROBE_READ_LIMIT);
    this.now = options.now ?? (() => new Date());
  }

  timestamp(): string {
    return this.now().toISOString();
  }

  append(result: ObsidianWorkflowProbeResult): ObsidianWorkflowProbeResult {
    const sanitized: ObsidianWorkflowProbeResult = {
      ...result,
      evidence: result.evidence.map(redactRuntimeCapabilityEvidence).slice(0, 8),
      assertions: result.assertions.map((assertion) => ({
        ...assertion,
        ...(assertion.detail ? { detail: redactRuntimeCapabilityEvidence(assertion.detail).slice(0, 1000) } : {}),
      })),
      ...(result.failureReason ? { failureReason: redactRuntimeCapabilityEvidence(result.failureReason).slice(0, 1000) } : {}),
    };
    const filePath = resolveCanonicalPluginWorkflowProbePath(this.mindRoot, sanitized.pluginId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(sanitized)}\n`, 'utf-8');
    this.trim(filePath);
    return sanitized;
  }

  read(pluginId: string, limit = this.defaultReadLimit): ObsidianWorkflowProbeHistory {
    const filePath = resolveCanonicalPluginWorkflowProbePath(this.mindRoot, pluginId);
    const validEntries: ObsidianWorkflowProbeResult[] = [];
    let skippedCorruptLines = 0;

    if (!fs.existsSync(filePath)) {
      return {
        total: 0,
        entries: [],
        latestById: {},
        skippedCorruptLines: 0,
      };
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const entry = parseProbeResult(line, pluginId);
      if (!entry) {
        skippedCorruptLines += 1;
        continue;
      }
      validEntries.push(entry);
    }

    const latestById: Partial<Record<ObsidianWorkflowProbeId, ObsidianWorkflowProbeResult>> = {};
    for (const entry of validEntries) {
      latestById[entry.id] = entry;
    }
    const updatedAt = validEntries.at(-1)?.completedAt;

    return {
      total: validEntries.length,
      entries: validEntries.slice(-Math.max(1, limit)),
      latestById,
      ...(updatedAt ? { updatedAt } : {}),
      skippedCorruptLines,
    };
  }

  private trim(filePath: string): void {
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    if (lines.length <= this.maxEntriesPerPlugin) return;
    fs.writeFileSync(filePath, `${lines.slice(-this.maxEntriesPerPlugin).join('\n')}\n`, 'utf-8');
  }
}

export async function runObsidianWorkflowProbe(input: RunObsidianWorkflowProbeInput): Promise<ObsidianWorkflowProbeResult> {
  const plugin = input.host.list().find((item) => item.id === input.pluginId);
  if (!plugin) {
    throw new Error(`Unknown Obsidian plugin for workflow probe: ${input.pluginId}`);
  }
  const definition = resolveProbeDefinition(plugin.id, input.probeId);
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let draft: WorkflowProbeDraft;

  try {
    draft = await definition.run({
      mindRoot: input.mindRoot,
      host: input.host,
      plugin,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    draft = {
      status: 'failed',
      evidence: [`Probe threw before completing: ${message}`],
      assertions: [{
        id: 'probe-execution',
        label: 'Probe executed without throwing',
        passed: false,
        detail: message,
      }],
      failureReason: message,
    };
  }

  const completedAt = now().toISOString();
  return {
    schemaVersion: OBSIDIAN_WORKFLOW_PROBE_SCHEMA_VERSION,
    pluginId: plugin.id,
    id: definition.id,
    label: definition.label,
    source: 'workflow-probe',
    startedAt,
    completedAt,
    ...draft,
  };
}

export async function runObsidianWorkflowProbes(input: RunObsidianWorkflowProbeInput): Promise<ObsidianWorkflowProbeResult[]> {
  const plugin = input.host.list().find((item) => item.id === input.pluginId);
  if (!plugin) {
    throw new Error(`Unknown Obsidian plugin for workflow probe: ${input.pluginId}`);
  }
  const definitions = probeDefinitionsForPlugin(plugin.id);
  const selected = input.probeId ? definitions.filter((definition) => definition.id === input.probeId) : definitions;
  const results: ObsidianWorkflowProbeResult[] = [];
  for (const definition of selected) {
    results.push(await runObsidianWorkflowProbe({
      ...input,
      probeId: definition.id,
    }));
  }
  return results;
}

export function buildObsidianWorkflowProbeAudits(history: ObsidianWorkflowProbeHistory | undefined): ObsidianWorkflowAudit[] {
  return Object.values(history?.latestById ?? {})
    .filter((result): result is ObsidianWorkflowProbeResult => Boolean(result))
    .map((result) => workflowAuditFromProbeResult(result));
}

export function workflowAuditFromProbeResult(result: ObsidianWorkflowProbeResult): ObsidianWorkflowAudit {
  const passed = result.status === 'passed';
  return {
    id: result.id,
    label: result.label,
    status: passed ? 'observed' : result.status === 'failed' ? 'partial' : 'not-observed',
    source: 'workflow-probe',
    evidence: probeEvidence(result),
    ...(passed ? { lastObservedAt: result.completedAt } : {}),
    lastProbedAt: result.completedAt,
    lastProbeStatus: result.status,
    ...(result.failureReason ? { probeFailureReason: result.failureReason } : {}),
    nextStep: passed
      ? 'Keep this workflow in the real-plugin probe harness so regressions cannot silently fall back to load-only compatibility.'
      : result.failureReason ?? 'Run the workflow probe after the plugin has a configured, executable workflow.',
  };
}

function resolveProbeDefinition(pluginId: string, requested?: ObsidianWorkflowProbeId): WorkflowProbeDefinition {
  const definitions = probeDefinitionsForPlugin(pluginId);
  if (requested) {
    const definition = definitions.find((item) => item.id === requested);
    if (!definition) throw new Error(`Workflow probe "${requested}" is not available for plugin: ${pluginId}`);
    return definition;
  }
  const definition = definitions[0];
  if (!definition) throw new Error(`No workflow probe is available for plugin: ${pluginId}`);
  return definition;
}

function probeDefinitionsForPlugin(pluginId: string): WorkflowProbeDefinition[] {
  const normalized = pluginId.toLowerCase();
  return PROBE_DEFINITIONS.filter((definition) => definition.pluginIds.has(normalized));
}

const PROBE_DEFINITIONS: WorkflowProbeDefinition[] = [
  {
    id: 'quickadd-capture-macro',
    label: 'Run capture or macro commands',
    pluginIds: new Set(['quickadd']),
    run: runQuickAddProbe,
  },
  {
    id: 'calendar-open-periodic-note',
    label: 'Open calendar views and notes',
    pluginIds: new Set(['calendar', 'obsidian-calendar-plugin']),
    run: runCalendarProbe,
  },
  {
    id: 'tag-wrangler-rename',
    label: 'Rename or organize tags',
    pluginIds: new Set(['tag-wrangler']),
    run: runTagWranglerProbe,
  },
  {
    id: 'linter-review-apply',
    label: 'Review and apply Markdown lint fixes',
    pluginIds: new Set(['obsidian-linter']),
    run: runLinterProbe,
  },
  {
    id: 'admonition-render-markdown',
    label: 'Render admonition blocks',
    pluginIds: new Set(['obsidian-admonition', 'admonition']),
    run: runAdmonitionProbe,
  },
];

async function runQuickAddProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectCommand(input.plugin, [/quickadd/i, /capture/i, /macro/i, /choice/i, /add/i]);
  if (!command) return skippedDraft('No executable QuickAdd command was registered for the capture/macro workflow.');

  return runCommandProbe({
    ...input,
    command,
    calledCapabilities: ['addCommand', 'Modal', 'SuggestModal', 'Menu', 'MenuItem'],
    observableLabel: 'QuickAdd command produced an observable vault, modal, menu, notice, or navigation result.',
  });
}

async function runCalendarProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const view = input.plugin.runtime.viewList?.[0];
  if (view) {
    const viewDraft = await runCalendarViewProbe(input, view.type);
    if (viewDraft.status === 'passed') return viewDraft;
  }

  const command = selectCommand(input.plugin, [/today/i, /daily/i, /periodic/i, /calendar/i, /open/i]);
  if (command) {
    return runCommandProbe({
      ...input,
      command,
      calledCapabilities: ['Workspace.openLinkText', 'registerView', 'addCommand'],
      observableLabel: 'Calendar command produced a workspace navigation, view, notice, or vault result.',
      requireWorkspaceOrView: true,
    });
  }

  if (!view) return skippedDraft('No executable Calendar command or registered view was available to probe.');
  return runCalendarViewProbe(input, view.type);
}

async function runCalendarViewProbe(input: WorkflowProbeRuntimeInput, viewType: string): Promise<WorkflowProbeDraft> {
  const snapshot = await input.host.renderView(input.plugin.id, viewType);
  const text = [snapshot.displayText, snapshot.text].filter(Boolean).join(' ').trim();
  const called = hasCalledLedger(input.host, input.plugin.id, ['registerView']);
  return {
    status: text && called ? 'passed' : 'failed',
    evidence: text ? [`Rendered Calendar view "${viewType}": ${text.slice(0, 160)}`] : [`Calendar view "${viewType}" rendered without visible text.`],
    assertions: [
      { id: 'render-view', label: 'Rendered a registered Calendar view', passed: Boolean(text), detail: viewType },
      { id: 'runtime-called-ledger', label: 'Recorded called runtime ledger evidence', passed: called },
    ],
    ...(!text || !called ? { failureReason: 'Calendar probe rendered a view but did not produce visible output with called ledger evidence.' } : {}),
  };
}

async function runTagWranglerProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectCommand(input.plugin, [/tag/i, /rename/i, /wrangler/i]);
  if (!command) return skippedDraft('No executable Tag Wrangler command was registered; full rename/write probe remains a later stage.');
  return runCommandProbe({
    ...input,
    command,
    calledCapabilities: ['addCommand', 'Menu', 'Vault.modify', 'MetadataCache'],
    observableLabel: 'Tag Wrangler command produced a menu, notice, navigation, or vault update.',
  });
}

async function runLinterProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectCommand(input.plugin, [/lint/i, /fix/i, /format/i]);
  if (!command) return skippedDraft('No executable Linter command was registered; MindOS-owned Linter adapter remains the primary compatibility path.');
  const fixturePath = 'workflow-probes/linter-fixture.md';
  writeVaultFile(input.mindRoot, fixturePath, '#Heading  \n\n\nbody');
  return runCommandProbe({
    ...input,
    command,
    context: { editor: { sourcePath: fixturePath } },
    calledCapabilities: ['addCommand'],
    observableLabel: 'Linter command produced editor updates, notices, or vault changes.',
  });
}

async function runAdmonitionProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const renders = await input.host.renderMarkdownPostProcessors('```admonition\nnote\n```', 'workflow-probes/admonition.md');
  const ownRenders = renders.filter((render) => render.pluginId === input.plugin.id);
  const visible = ownRenders.some((render) => Boolean(render.text.trim()) && !render.error);
  if (ownRenders.length === 0) {
    return skippedDraft('No Admonition Markdown post processor was available; prefer MindOS native callout rendering until a processor is registered.');
  }
  return {
    status: visible ? 'passed' : 'failed',
    evidence: ownRenders.map((render) => render.error ? `Processor failed: ${render.error}` : `Processor output: ${render.text.slice(0, 160)}`),
    assertions: [
      { id: 'render-markdown', label: 'Rendered an Admonition Markdown fixture', passed: visible },
      { id: 'runtime-called-ledger', label: 'Recorded called runtime ledger evidence', passed: hasCalledLedger(input.host, input.plugin.id, ['registerMarkdownPostProcessor']) },
    ],
    ...(!visible ? { failureReason: 'Admonition processor did not produce visible snapshot output.' } : {}),
  };
}

async function runCommandProbe(input: WorkflowProbeRuntimeInput & {
  command: ObsidianWorkflowProbeCommand;
  calledCapabilities: string[];
  observableLabel: string;
  context?: PluginRuntimeContext;
  requireWorkspaceOrView?: boolean;
}): Promise<WorkflowProbeDraft> {
  const before = snapshotVault(input.mindRoot);
  const action = await input.host.executeCommand(input.command.fullId, input.context);
  const after = snapshotVault(input.mindRoot);
  const changes = diffVaultSnapshots(before, after);
  const observable = observableEvidence(action, changes);
  const hasRequiredObservable = input.requireWorkspaceOrView
    ? action.workspaceOpenRequests.length > 0 || observable.some((item) => item.includes('view'))
    : observable.length > 0;
  const called = hasCalledLedger(input.host, input.plugin.id, input.calledCapabilities);
  const passed = hasRequiredObservable && called;
  const failureReason = passed ? undefined : [
    !hasRequiredObservable ? 'command executed but produced no observable workflow result' : '',
    !called ? 'runtime ledger did not record called evidence for the probed workflow' : '',
  ].filter(Boolean).join('; ');

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Executed command "${input.command.name}" (${input.command.fullId}).`,
      ...observable,
    ],
    assertions: [
      { id: 'execute-command', label: 'Executed the selected workflow command', passed: true, detail: input.command.fullId },
      ...(input.requireWorkspaceOrView ? [{
        id: 'workspace-open',
        label: 'Observed workspace navigation or view output',
        passed: action.workspaceOpenRequests.length > 0,
        detail: action.workspaceOpenRequests.map((request) => request.targetPath ?? request.linktext).join(', ') || 'No workspace navigation.',
      }] : []),
      { id: 'observable-result', label: input.observableLabel, passed: hasRequiredObservable, detail: observable.join(' | ') || 'No observable result.' },
      { id: 'runtime-called-ledger', label: 'Recorded called runtime ledger evidence', passed: called },
    ],
    ...(failureReason ? { failureReason } : {}),
  };
}

function selectCommand(plugin: ObsidianWorkflowProbePlugin, patterns: RegExp[]): ObsidianWorkflowProbeCommand | undefined {
  const commands = plugin.runtime.commandList.filter((command) => command.executable !== false);
  for (const pattern of patterns) {
    const match = commands.find((command) => (
      pattern.test(command.id) || pattern.test(command.name) || pattern.test(command.fullId)
    ));
    if (match) return match;
  }
  return commands[0];
}

function hasCalledLedger(host: ObsidianWorkflowProbeHost, pluginId: string, capabilities: string[]): boolean {
  const plugin = host.list().find((item) => item.id === pluginId);
  if (!plugin) return false;
  const capabilitySet = new Set(capabilities);
  return (plugin.runtime.capabilityLedger ?? []).some((entry) => (
    entry.phase === 'called' && capabilitySet.has(entry.capability)
  ));
}

function skippedDraft(reason: string): WorkflowProbeDraft {
  return {
    status: 'skipped',
    evidence: [reason],
    assertions: [{
      id: 'probe-available',
      label: 'Workflow probe has an executable target',
      passed: false,
      detail: reason,
    }],
    failureReason: reason,
  };
}

function observableEvidence(action: PluginActionResult, changes: string[]): string[] {
  const evidence: string[] = [];
  for (const request of action.workspaceOpenRequests) {
    evidence.push(request.targetPath
      ? `Observed workspace open request to "${request.linktext}" -> "${request.targetPath}".`
      : `Observed workspace open request to "${request.linktext}".`);
  }
  if (action.modalSnapshots.length > 0) {
    evidence.push(`Observed ${action.modalSnapshots.length} modal snapshot(s).`);
  }
  if (action.menuSnapshots.length > 0) {
    evidence.push(`Observed ${action.menuSnapshots.length} menu snapshot(s).`);
  }
  if ((action.noticeSnapshots ?? []).length > 0) {
    evidence.push(`Observed ${action.noticeSnapshots?.length ?? 0} notice snapshot(s).`);
  }
  if ((action.editorUpdates ?? []).length > 0) {
    evidence.push(`Observed ${action.editorUpdates?.length ?? 0} editor update(s).`);
  }
  for (const change of changes.slice(0, 5)) {
    evidence.push(`Observed vault file change: ${change}.`);
  }
  return evidence;
}

function snapshotVault(mindRoot: string): VaultSnapshot {
  const files = new Map<string, { size: number; mtimeMs: number }>();
  walkVault(mindRoot, '', files);
  return { files };
}

function walkVault(root: string, relativeDir: string, files: VaultSnapshot['files']): void {
  const dir = path.join(root, relativeDir);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (relativeDir === '' && PRIVATE_ROOTS.has(entry.name)) continue;
    const relativePath = toPosixPath(path.join(relativeDir, entry.name));
    const fullPath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      walkVault(root, relativePath, files);
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      files.set(relativePath, { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
}

function diffVaultSnapshots(before: VaultSnapshot, after: VaultSnapshot): string[] {
  const changes: string[] = [];
  for (const [filePath, next] of after.files.entries()) {
    const prev = before.files.get(filePath);
    if (!prev) {
      changes.push(`${filePath} created`);
    } else if (prev.size !== next.size || prev.mtimeMs !== next.mtimeMs) {
      changes.push(`${filePath} changed`);
    }
  }
  return changes;
}

function writeVaultFile(mindRoot: string, relativePath: string, content: string): void {
  const fullPath = path.join(mindRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function probeEvidence(result: ObsidianWorkflowProbeResult): string[] {
  const assertions = result.assertions
    .filter((assertion) => !assertion.passed)
    .map((assertion) => assertion.detail ? `${assertion.label}: ${assertion.detail}` : assertion.label);
  return [
    ...result.evidence,
    ...assertions,
  ].filter(Boolean).slice(0, 3);
}

function parseProbeResult(line: string, expectedPluginId: string): ObsidianWorkflowProbeResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== OBSIDIAN_WORKFLOW_PROBE_SCHEMA_VERSION) return null;
  if (record.pluginId !== expectedPluginId) return null;
  if (!isObsidianWorkflowProbeId(record.id)) return null;
  if (!isProbeStatus(record.status)) return null;
  if (record.source !== 'workflow-probe') return null;
  if (typeof record.label !== 'string') return null;
  if (typeof record.startedAt !== 'string') return null;
  if (typeof record.completedAt !== 'string') return null;
  if (!Array.isArray(record.evidence)) return null;
  if (!Array.isArray(record.assertions)) return null;

  return {
    schemaVersion: OBSIDIAN_WORKFLOW_PROBE_SCHEMA_VERSION,
    pluginId: expectedPluginId,
    id: record.id,
    label: record.label,
    status: record.status,
    source: 'workflow-probe',
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    evidence: record.evidence.filter((item): item is string => typeof item === 'string'),
    assertions: record.assertions.filter(isProbeAssertion),
    ...(typeof record.failureReason === 'string' ? { failureReason: record.failureReason } : {}),
  };
}

export function isObsidianWorkflowProbeId(value: unknown): value is ObsidianWorkflowProbeId {
  return typeof value === 'string' && PROBE_IDS.has(value as ObsidianWorkflowProbeId);
}

function isProbeStatus(value: unknown): value is ObsidianWorkflowProbeStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped';
}

function isProbeAssertion(value: unknown): value is ObsidianWorkflowProbeAssertion {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && typeof record.passed === 'boolean'
    && (record.detail === undefined || typeof record.detail === 'string');
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

const PROBE_IDS = new Set<ObsidianWorkflowProbeId>([
  'quickadd-capture-macro',
  'calendar-open-periodic-note',
  'tag-wrangler-rename',
  'linter-review-apply',
  'admonition-render-markdown',
]);

const PRIVATE_ROOTS = new Set(['.git', '.mindos', '.obsidian', '.plugins', 'node_modules']);
