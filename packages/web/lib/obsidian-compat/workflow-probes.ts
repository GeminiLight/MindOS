import fs from 'fs';
import path from 'path';
import type { PluginActionResult, PluginCalendarDateContext, PluginEditorMenuContext, PluginRuntimeContext, PluginViewContext } from './plugin-manager';
import type { ManagedPluginMarkdownPostProcessorSnapshot } from './plugin-manager';
import type { ObsidianWorkflowAudit } from './workflow-audit';
import { redactRuntimeCapabilityEvidence } from './runtime-capability-ledger-store';
import { resolveCanonicalPluginWorkflowProbePath, resolveInstalledObsidianPluginDir } from './plugin-paths';
import {
  QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE,
  QUICKADD_WORKFLOW_PROBE_FIXTURE,
} from './quickadd-workflow-fixture';
import { PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE } from './periodic-notes-workflow-fixture';
import { HOMEPAGE_WORKFLOW_PROBE_FIXTURE } from './homepage-workflow-fixture';
import { CALENDAR_WORKFLOW_PROBE_FIXTURE } from './calendar-workflow-fixture';

export const OBSIDIAN_WORKFLOW_PROBE_SCHEMA_VERSION = 1;
export const DEFAULT_OBSIDIAN_WORKFLOW_PROBE_MAX_ENTRIES = 100;
export const DEFAULT_OBSIDIAN_WORKFLOW_PROBE_READ_LIMIT = 50;

export type ObsidianWorkflowProbeId =
  | 'quickadd-capture-macro'
  | 'quickadd-template-note'
  | 'calendar-open-periodic-note'
  | 'periodic-notes-open-daily-note'
  | 'homepage-open-note'
  | 'tag-wrangler-rename'
  | 'linter-review-apply'
  | 'admonition-render-markdown'
  | 'recent-files-open-view';

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
  triggerEditorMenu?(pluginId: string, context: PluginEditorMenuContext): Promise<PluginActionResult>;
  chooseMenuItem?(menuId: string, itemIndex: number, interactionId: string): Promise<PluginActionResult>;
  submitModalText?(modalId: string, text: string, interactionId: string): Promise<PluginActionResult>;
  renderView(pluginId: string, viewType: string, context?: PluginViewContext): Promise<{ text?: string; displayText?: string }>;
  openCalendarDate?(pluginId: string, context: PluginCalendarDateContext): Promise<PluginActionResult>;
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

interface QuickAddFixtureCommandSpec {
  choiceId: string;
  choiceName: string;
}

interface QuickAddChoiceProbeSpec {
  command: ObsidianWorkflowProbeCommand | undefined;
  missingCommandReason: string;
  workflowKind: string;
  targetDescription: string;
  targetPath: string;
  expectedContent: string;
  contentDescription: string;
  targetAssertionId: string;
  targetAssertionLabel: string;
  contentAssertionId: string;
  contentAssertionLabel: string;
  fixture: QuickAddFixtureCommandSpec;
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
    id: 'quickadd-template-note',
    label: 'Create note from template choice',
    pluginIds: new Set(['quickadd']),
    run: runQuickAddTemplateProbe,
  },
  {
    id: 'calendar-open-periodic-note',
    label: 'Open calendar views and notes',
    pluginIds: new Set(['calendar', 'calendar-beta', 'obsidian-calendar-plugin']),
    run: runCalendarProbe,
  },
  {
    id: 'periodic-notes-open-daily-note',
    label: 'Create and open daily note',
    pluginIds: new Set(['periodic-notes']),
    run: runPeriodicNotesProbe,
  },
  {
    id: 'homepage-open-note',
    label: 'Open configured homepage note',
    pluginIds: new Set(['homepage']),
    run: runHomepageProbe,
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
  {
    id: 'recent-files-open-view',
    label: 'Open recent files view',
    pluginIds: new Set(['recent-files-obsidian']),
    run: runRecentFilesProbe,
  },
];

async function runQuickAddProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  return runQuickAddChoiceProbe(input, {
    command: selectQuickAddChoiceCommand(input.plugin),
    missingCommandReason: 'No configured QuickAdd choice command was registered; this probe requires a data.json-backed choice command, not only the generic Run modal.',
    workflowKind: 'capture',
    targetDescription: 'QuickAdd fixture note',
    targetPath: QUICKADD_WORKFLOW_PROBE_FIXTURE.targetPath,
    expectedContent: QUICKADD_WORKFLOW_PROBE_FIXTURE.captureContent,
    contentDescription: 'capture text',
    targetAssertionId: 'fixture-note-written',
    targetAssertionLabel: 'Changed the QuickAdd fixture capture note',
    contentAssertionId: 'fixture-note-content',
    contentAssertionLabel: 'Wrote the expected QuickAdd fixture capture content',
    fixture: QUICKADD_WORKFLOW_PROBE_FIXTURE,
  });
}

async function runQuickAddTemplateProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  return runQuickAddChoiceProbe(input, {
    command: selectQuickAddTemplateChoiceCommand(input.plugin),
    missingCommandReason: 'No configured QuickAdd Template choice command was registered; this probe requires the controlled MindOS Template data.json choice.',
    workflowKind: 'template',
    targetDescription: 'QuickAdd template fixture note',
    targetPath: QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.targetPath,
    expectedContent: QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.templateContent,
    contentDescription: 'template content',
    targetAssertionId: 'fixture-template-note-written',
    targetAssertionLabel: 'Created the QuickAdd fixture template note',
    contentAssertionId: 'fixture-template-note-content',
    contentAssertionLabel: 'Wrote the expected QuickAdd fixture template content',
    fixture: QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE,
  });
}

async function runQuickAddChoiceProbe(
  input: WorkflowProbeRuntimeInput,
  spec: QuickAddChoiceProbeSpec,
): Promise<WorkflowProbeDraft> {
  const command = spec.command;
  if (!command) {
    return skippedDraft(spec.missingCommandReason);
  }

  const before = snapshotVault(input.mindRoot);
  const action = await input.host.executeCommand(command.fullId);
  const after = snapshotVault(input.mindRoot);
  const changes = diffVaultSnapshots(before, after);
  const changedPaths = changedVaultPaths(changes);
  const observable = observableEvidence(action, changes);
  const choiceCommandCalled = hasCalledLedger(input.host, input.plugin.id, ['addCommand']);
  const vaultWriteCalled = hasCalledLedger(input.host, input.plugin.id, QUICKADD_VAULT_WRITE_CAPABILITIES);
  const publicVaultWrite = changedPaths.size > 0;
  const fixtureCommand = isQuickAddFixtureCommand(command, spec.fixture);
  const fixturePathChanged = changedPaths.has(spec.targetPath);
  const fixtureContent = fs.existsSync(path.join(input.mindRoot, spec.targetPath))
    ? readVaultFile(input.mindRoot, spec.targetPath)
    : '';
  const fixtureContentMatches = fixtureContent.includes(spec.expectedContent);
  const fixturePassed = fixtureCommand ? fixturePathChanged && fixtureContentMatches : true;
  const passed = choiceCommandCalled && vaultWriteCalled && publicVaultWrite && fixturePassed;
  const failureReason = passed ? undefined : [
    !choiceCommandCalled ? 'runtime ledger did not record QuickAdd command execution' : '',
    !vaultWriteCalled ? 'runtime ledger did not record a vault create/modify/write for the QuickAdd choice' : '',
    !publicVaultWrite ? 'configured QuickAdd choice did not change any public vault file' : '',
    fixtureCommand && !fixturePathChanged ? `${spec.targetDescription} was not changed: ${spec.targetPath}` : '',
    fixtureCommand && !fixtureContentMatches ? `${spec.targetDescription} did not contain expected ${spec.contentDescription}: ${spec.expectedContent}` : '',
  ].filter(Boolean).join('; ');

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Executed QuickAdd ${spec.workflowKind} choice command "${command.name}" (${command.fullId}).`,
      ...(fixtureCommand ? [
        fixturePathChanged
          ? `Observed ${spec.targetDescription} change: ${spec.targetPath}.`
          : `Expected ${spec.targetDescription} to change: ${spec.targetPath}.`,
        fixtureContentMatches
          ? `Verified ${spec.targetDescription} "${spec.targetPath}" contains the expected ${spec.contentDescription}.`
          : `Expected ${spec.targetDescription} "${spec.targetPath}" to contain "${spec.expectedContent}".`,
      ] : []),
      ...observable,
      ...(!publicVaultWrite ? ['No public vault file changed after the QuickAdd choice command executed.'] : []),
      ...(fixtureCommand && !fixtureContentMatches ? [`Observed ${spec.targetDescription} content: ${fixtureContent.slice(0, 160) || '(missing)'}`] : []),
    ],
    assertions: [
      { id: 'execute-command', label: 'Executed the selected QuickAdd choice command', passed: true, detail: command.fullId },
      { id: 'quickadd-choice-command', label: 'Selected a configured QuickAdd choice command', passed: true, detail: command.id },
      { id: 'observable-result', label: 'QuickAdd choice changed a public vault file', passed: publicVaultWrite, detail: Array.from(changedPaths).join(', ') || 'No changed files.' },
      ...(fixtureCommand ? [
        { id: spec.targetAssertionId, label: spec.targetAssertionLabel, passed: fixturePathChanged, detail: spec.targetPath },
        { id: spec.contentAssertionId, label: spec.contentAssertionLabel, passed: fixtureContentMatches, detail: spec.expectedContent },
      ] : []),
      { id: 'vault-write-called-ledger', label: 'Recorded vault write evidence for the QuickAdd choice', passed: vaultWriteCalled },
      { id: 'runtime-called-ledger', label: 'Recorded called runtime ledger evidence', passed: choiceCommandCalled },
    ],
    ...(failureReason ? { failureReason } : {}),
  };
}

async function runCalendarProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  if (!input.host.openCalendarDate) {
    return skippedDraft('Workflow host cannot trigger Calendar date navigation.');
  }
  const view = selectCalendarView(input.plugin);
  if (!view) {
    return skippedDraft('No registered Calendar view was available to trigger date navigation.');
  }
  if (!hasCalendarFixtureNote(input.mindRoot)) {
    return skippedDraft(`No controlled Calendar daily note fixture was available at ${CALENDAR_WORKFLOW_PROBE_FIXTURE.targetPath}; seed the existing note before marking this workflow observed.`);
  }

  const targetPath = CALENDAR_WORKFLOW_PROBE_FIXTURE.targetPath;
  const targetContent = readVaultFile(input.mindRoot, targetPath);
  const targetContentMatches = targetContent.includes(CALENDAR_WORKFLOW_PROBE_FIXTURE.expectedContent);
  let action: PluginActionResult;

  try {
    action = await input.host.openCalendarDate(input.plugin.id, {
      viewType: view.type,
      targetDate: CALENDAR_WORKFLOW_PROBE_FIXTURE.targetDate,
      targetPath,
      granularity: CALENDAR_WORKFLOW_PROBE_FIXTURE.granularity,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const viewCalled = hasCalledLedger(input.host, input.plugin.id, ['registerView']);
    const workspaceCalled = hasCalledLedger(input.host, input.plugin.id, ['Workspace.openLinkText']);
    return {
      status: 'failed',
      evidence: [
        `Calendar date navigation for ${CALENDAR_WORKFLOW_PROBE_FIXTURE.targetDate} failed before workspace evidence: ${message}`,
      ],
      assertions: [
        { id: 'calendar-fixture-note-content', label: 'Verified the Calendar daily note fixture content', passed: targetContentMatches, detail: targetPath },
        { id: 'calendar-date-navigation', label: 'Triggered Calendar date navigation handler', passed: false, detail: message },
        { id: 'workspace-open', label: 'Requested workspace opening for the Calendar daily note', passed: false, detail: targetPath },
        { id: 'view-called-ledger', label: 'Recorded Calendar view handler evidence', passed: viewCalled },
        { id: 'workspace-open-called-ledger', label: 'Recorded workspace open evidence for the Calendar daily note', passed: workspaceCalled },
      ],
      failureReason: message,
    };
  }

  const workspaceOpened = action.workspaceOpenRequests.some((request) => (
    workflowPathMatches(request.targetPath ?? request.linktext, targetPath)
  ));
  const viewCalled = hasCalledLedger(input.host, input.plugin.id, ['registerView']);
  const workspaceCalled = hasCalledLedger(input.host, input.plugin.id, ['Workspace.openLinkText']);
  const observable = observableEvidence(action, []);
  const passed = targetContentMatches && workspaceOpened && viewCalled && workspaceCalled;

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Triggered Calendar date navigation for ${CALENDAR_WORKFLOW_PROBE_FIXTURE.targetDate} through view "${view.type}".`,
      targetContentMatches
        ? `Verified Calendar fixture note "${targetPath}" contains the expected content.`
        : `Expected Calendar fixture note "${targetPath}" to contain "${CALENDAR_WORKFLOW_PROBE_FIXTURE.expectedContent}".`,
      workspaceOpened
        ? `Observed workspace open request for Calendar fixture: ${targetPath}.`
        : `Expected workspace open request for Calendar fixture: ${targetPath}.`,
      ...observable,
      ...(!targetContentMatches ? [`Observed Calendar fixture note content: ${targetContent.slice(0, 160) || '(missing)'}`] : []),
    ],
    assertions: [
      { id: 'calendar-fixture-note-content', label: 'Verified the Calendar daily note fixture content', passed: targetContentMatches, detail: targetPath },
      { id: 'calendar-date-navigation', label: 'Triggered Calendar date navigation handler', passed: true, detail: CALENDAR_WORKFLOW_PROBE_FIXTURE.targetDate },
      { id: 'workspace-open', label: 'Requested workspace opening for the Calendar daily note', passed: workspaceOpened, detail: targetPath },
      { id: 'view-called-ledger', label: 'Recorded Calendar view handler evidence', passed: viewCalled },
      { id: 'workspace-open-called-ledger', label: 'Recorded workspace open evidence for the Calendar daily note', passed: workspaceCalled },
    ],
    ...(!passed ? {
      failureReason: calendarFailureReason({
        targetContentMatches,
        workspaceOpened,
        viewCalled,
        workspaceCalled,
      }),
    } : {}),
  };
}

async function runPeriodicNotesProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectPeriodicNotesDailyCommand(input.plugin);
  if (!command) {
    return skippedDraft('No executable Periodic Notes daily command was registered; seed data.json daily.enabled before marking this workflow observed.');
  }
  if (!hasPeriodicNotesDailyFixtureSettings(input.mindRoot, input.plugin.id)) {
    return skippedDraft('No controlled data.json-backed Periodic Notes daily fixture was available; seed daily settings and template before marking this workflow observed.');
  }

  const targetPath = PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.targetPath;
  const before = snapshotVault(input.mindRoot);
  const action = await input.host.executeCommand(command.fullId);
  const after = snapshotVault(input.mindRoot);
  const changes = diffVaultSnapshots(before, after);
  const changedPaths = changedVaultPaths(changes);
  const targetChanged = changedPaths.has(targetPath);
  const targetExists = fs.existsSync(path.join(input.mindRoot, targetPath));
  const targetContent = targetExists ? readVaultFile(input.mindRoot, targetPath) : '';
  const targetContentMatches = targetContent.includes(PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.expectedContent)
    && targetContent.includes('mindos-periodic-daily');
  const workspaceOpened = action.workspaceOpenRequests.some((request) => (
    normalizeWorkflowPath(request.targetPath ?? request.linktext) === targetPath
  ));
  const commandCalled = hasCalledLedger(input.host, input.plugin.id, ['addCommand']);
  const vaultCreateCalled = hasCalledLedger(input.host, input.plugin.id, ['Vault.create']);
  const workspaceCalled = hasCalledLedger(input.host, input.plugin.id, ['Workspace.openLinkText']);
  const passed = commandCalled
    && vaultCreateCalled
    && workspaceCalled
    && targetChanged
    && targetExists
    && targetContentMatches
    && workspaceOpened;
  const observable = observableEvidence(action, changes);

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Executed Periodic Notes daily command "${command.name}" (${command.fullId}).`,
      targetChanged
        ? `Observed Periodic Notes daily fixture note change: ${targetPath}.`
        : `Expected Periodic Notes daily fixture note to change: ${targetPath}.`,
      targetContentMatches
        ? `Verified Periodic Notes daily fixture note "${targetPath}" contains the expected template content.`
        : `Expected Periodic Notes daily fixture note "${targetPath}" to contain "${PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.expectedContent}".`,
      workspaceOpened
        ? `Observed workspace open request for Periodic Notes daily fixture: ${targetPath}.`
        : `Expected workspace open request for Periodic Notes daily fixture: ${targetPath}.`,
      ...observable,
      ...(!targetContentMatches ? [`Observed Periodic Notes fixture note content: ${targetContent.slice(0, 160) || '(missing)'}`] : []),
    ],
    assertions: [
      { id: 'execute-command', label: 'Executed the selected Periodic Notes daily command', passed: true, detail: command.fullId },
      { id: 'data-json-daily-settings', label: 'Selected controlled data.json-backed daily settings', passed: true, detail: PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.format },
      { id: 'fixture-note-written', label: 'Created or changed the Periodic Notes daily fixture note', passed: targetChanged, detail: targetPath },
      { id: 'fixture-note-content', label: 'Wrote the expected Periodic Notes template content', passed: targetContentMatches, detail: PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.expectedContent },
      { id: 'workspace-open', label: 'Requested workspace opening for the Periodic Notes daily note', passed: workspaceOpened, detail: targetPath },
      { id: 'vault-create-called-ledger', label: 'Recorded vault create evidence for the Periodic Notes daily note', passed: vaultCreateCalled },
      { id: 'workspace-open-called-ledger', label: 'Recorded workspace open evidence for the Periodic Notes daily note', passed: workspaceCalled },
      { id: 'runtime-called-ledger', label: 'Recorded command execution evidence', passed: commandCalled },
    ],
    ...(!passed ? {
      failureReason: periodicNotesFailureReason({
        commandCalled,
        vaultCreateCalled,
        workspaceCalled,
        targetChanged,
        targetExists,
        targetContentMatches,
        workspaceOpened,
      }),
    } : {}),
  };
}

async function runHomepageProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectHomepageOpenCommand(input.plugin);
  if (!command) {
    return skippedDraft('No executable Homepage open-homepage command was registered; seed data.json before marking this workflow observed.');
  }
  if (!hasHomepageFixtureSettings(input.mindRoot, input.plugin.id)) {
    return skippedDraft('No controlled data.json-backed Homepage File fixture was available; seed a Homepage v4 File entry before marking this workflow observed.');
  }

  const targetPath = HOMEPAGE_WORKFLOW_PROBE_FIXTURE.targetPath;
  const targetExists = fs.existsSync(path.join(input.mindRoot, targetPath));
  const targetContent = targetExists ? readVaultFile(input.mindRoot, targetPath) : '';
  const targetContentMatches = targetContent.includes(HOMEPAGE_WORKFLOW_PROBE_FIXTURE.expectedContent);
  const action = await input.host.executeCommand(command.fullId);
  const workspaceOpened = action.workspaceOpenRequests.some((request) => (
    workflowPathMatches(request.targetPath ?? request.linktext, targetPath)
  ));
  const commandCalled = hasCalledLedger(input.host, input.plugin.id, ['addCommand']);
  const workspaceCalled = hasCalledLedger(input.host, input.plugin.id, ['Workspace.openLinkText']);
  const passed = commandCalled
    && workspaceCalled
    && targetExists
    && targetContentMatches
    && workspaceOpened;
  const observable = observableEvidence(action, []);

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Executed Homepage command "${command.name}" (${command.fullId}).`,
      targetContentMatches
        ? `Verified Homepage fixture note "${targetPath}" contains the expected content.`
        : `Expected Homepage fixture note "${targetPath}" to contain "${HOMEPAGE_WORKFLOW_PROBE_FIXTURE.expectedContent}".`,
      workspaceOpened
        ? `Observed workspace open request for Homepage fixture: ${targetPath}.`
        : `Expected workspace open request for Homepage fixture: ${targetPath}.`,
      ...observable,
      ...(!targetContentMatches ? [`Observed Homepage fixture note content: ${targetContent.slice(0, 160) || '(missing)'}`] : []),
    ],
    assertions: [
      { id: 'execute-command', label: 'Executed the selected Homepage command', passed: true, detail: command.fullId },
      { id: 'data-json-homepage-settings', label: 'Selected controlled data.json-backed Homepage File settings', passed: true, detail: HOMEPAGE_WORKFLOW_PROBE_FIXTURE.homepageName },
      { id: 'homepage-note-content', label: 'Verified the configured Homepage note content', passed: targetContentMatches, detail: targetPath },
      { id: 'workspace-open', label: 'Requested workspace opening for the Homepage note', passed: workspaceOpened, detail: targetPath },
      { id: 'workspace-open-called-ledger', label: 'Recorded workspace open evidence for the Homepage note', passed: workspaceCalled },
      { id: 'runtime-called-ledger', label: 'Recorded command execution evidence', passed: commandCalled },
    ],
    ...(!passed ? {
      failureReason: homepageFailureReason({
        commandCalled,
        workspaceCalled,
        targetExists,
        targetContentMatches,
        workspaceOpened,
      }),
    } : {}),
  };
}

async function runTagWranglerProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectCommand(input.plugin, [/tag/i, /rename/i, /wrangler/i]);
  if (command) return runTagWranglerCommandProbe(input, command);
  return runTagWranglerEditorMenuProbe(input);
}

async function runTagWranglerCommandProbe(input: WorkflowProbeRuntimeInput, command: ObsidianWorkflowProbeCommand): Promise<WorkflowProbeDraft> {
  writeTagWranglerFixture(input.mindRoot);
  const before = snapshotVault(input.mindRoot);
  const action = await input.host.executeCommand(command.fullId);
  const after = snapshotVault(input.mindRoot);
  const changes = diffVaultSnapshots(before, after);
  const commandCalled = hasCalledLedger(input.host, input.plugin.id, ['addCommand']);
  return buildTagWranglerRenameDraft(input, {
    action,
    changes,
    entrypointEvidence: [
      `Executed command "${command.name}" (${command.fullId}).`,
    ],
    entrypointAssertions: [
      { id: 'execute-command', label: 'Executed the selected Tag Wrangler workflow command', passed: true, detail: command.fullId },
      { id: 'runtime-called-ledger', label: 'Recorded command execution evidence', passed: commandCalled },
    ],
    entrypointFailures: [
      !commandCalled ? 'runtime ledger did not record command execution' : '',
    ],
  });
}

async function runTagWranglerEditorMenuProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  if (!input.host.triggerEditorMenu || !input.host.chooseMenuItem) {
    return skippedDraft('No executable Tag Wrangler command was registered, and this host cannot trigger editor-menu/menu-item workflow probes yet.');
  }

  writeTagWranglerFixture(input.mindRoot);
  const before = snapshotVault(input.mindRoot);
  const openAction = await input.host.triggerEditorMenu(input.plugin.id, {
    sourcePath: TAG_WRANGLER_FIXTURE_PATHS[0],
    tagText: TAG_WRANGLER_OLD_TAG,
    cursorOffset: tagWranglerFixtureCursorOffset(),
  });
  const menuChoice = selectTagWranglerRenameMenuItem(openAction);
  let chooseAction: PluginActionResult | null = null;
  let submitAction: PluginActionResult | null = null;
  let chooseError = '';
  let submitError = '';
  let textPromptChoice: TagWranglerTextPromptChoice | null = null;

  if (menuChoice) {
    try {
      chooseAction = await input.host.chooseMenuItem(menuChoice.menuId, menuChoice.itemIndex, menuChoice.interactionId);
      textPromptChoice = selectTagWranglerRenameTextPrompt(chooseAction);
      if (textPromptChoice) {
        if (!input.host.submitModalText) {
          submitError = 'host cannot submit text modal continuations';
        } else {
          submitAction = await input.host.submitModalText(textPromptChoice.modalId, TAG_WRANGLER_NEW_TAG_NAME, textPromptChoice.interactionId);
        }
      }
    } catch (error) {
      if (textPromptChoice) {
        submitError = error instanceof Error ? error.message : String(error);
      } else {
        chooseError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const after = snapshotVault(input.mindRoot);
  const changes = diffVaultSnapshots(before, after);
  const action = mergePluginActionResults(mergePluginActionResults(openAction, chooseAction), submitAction);
  const editorMenuCalled = hasCalledLedger(input.host, input.plugin.id, ['Workspace.editor-menu']);
  const menuCalled = hasCalledLedger(input.host, input.plugin.id, ['Menu']);
  const menuItemCalled = hasCalledLedger(input.host, input.plugin.id, ['MenuItem']);
  const menuItemAvailable = Boolean(menuChoice);
  const menuItemExecuted = Boolean(menuChoice && chooseAction && !chooseError);
  const textPromptSubmitted = Boolean(textPromptChoice && submitAction && !submitError);

  return buildTagWranglerRenameDraft(input, {
    action,
    changes,
    entrypointEvidence: [
      `Triggered editor-menu for ${TAG_WRANGLER_OLD_TAG} in "${TAG_WRANGLER_FIXTURE_PATHS[0]}".`,
      ...openAction.menuSnapshots.flatMap((menu) => menu.items.map((item) => `Editor menu item: ${item.title || '(separator)'}`)).slice(0, 8),
      ...(menuChoice ? [`Selected menu item "${menuChoice.title}" from ${menuChoice.menuId}#${menuChoice.itemIndex}.`] : ['No executable Rename menu item was available after editor-menu trigger.']),
      ...(textPromptChoice ? [`Submitted text prompt "${textPromptChoice.title}" with "${TAG_WRANGLER_NEW_TAG_NAME}".`] : []),
      ...(chooseError ? [`Menu item execution failed: ${chooseError}`] : []),
      ...(submitError ? [`Text prompt submission failed: ${submitError}`] : []),
    ],
    entrypointAssertions: [
      { id: 'editor-menu-triggered', label: 'Triggered the Obsidian editor-menu event for a tag token', passed: editorMenuCalled },
      { id: 'rename-menu-item-available', label: 'Observed an executable Rename tag menu item', passed: menuItemAvailable, detail: menuChoice?.title ?? 'No executable rename item.' },
      { id: 'menu-item-executed', label: 'Executed the Rename tag menu item', passed: menuItemExecuted, detail: chooseError || menuChoice?.title || 'No menu item executed.' },
      ...(textPromptChoice ? [{ id: 'rename-text-prompt-submitted', label: 'Submitted the Rename tag text prompt', passed: textPromptSubmitted, detail: submitError || textPromptChoice.title }] : []),
      { id: 'menu-called-ledger', label: 'Recorded menu snapshot evidence', passed: menuCalled },
      { id: 'runtime-called-ledger', label: 'Recorded editor-menu and menu-item runtime evidence', passed: editorMenuCalled && menuItemCalled },
    ],
    entrypointFailures: [
      !editorMenuCalled ? 'runtime ledger did not record editor-menu execution' : '',
      !menuItemAvailable ? 'editor-menu did not expose an executable Rename tag item' : '',
      !menuItemExecuted ? 'rename menu item was not executed successfully' : '',
      textPromptChoice && !textPromptSubmitted ? 'rename text prompt was not submitted successfully' : '',
      !menuCalled ? 'runtime ledger did not record menu snapshot evidence' : '',
      !menuItemCalled ? 'runtime ledger did not record menu item execution' : '',
      chooseError ? `menu item execution failed: ${chooseError}` : '',
      submitError ? `text prompt submission failed: ${submitError}` : '',
    ],
  });
}

function buildTagWranglerRenameDraft(
  input: WorkflowProbeRuntimeInput,
  result: {
    action: PluginActionResult;
    changes: string[];
    entrypointEvidence: string[];
    entrypointAssertions: ObsidianWorkflowProbeAssertion[];
    entrypointFailures: string[];
  },
): WorkflowProbeDraft {
  const fixture = readTagWranglerFixture(input.mindRoot);
  const changedPaths = changedVaultPaths(result.changes);
  const changedFixturePaths = TAG_WRANGLER_FIXTURE_PATHS.filter((filePath) => changedPaths.has(filePath));
  const unexpectedChanges = Array.from(changedPaths).filter((filePath) => !TAG_WRANGLER_FIXTURE_PATHS.includes(filePath));
  const frontmatterRenamed = fixture.every((file) => frontmatterTagRenamed(file.content));
  const bodyRenamed = fixture.every((file) => bodyTagRenamed(file.content));
  const oldTagGone = fixture.every((file) => !file.content.includes(TAG_WRANGLER_OLD_TAG));
  const newTagPresent = fixture.every((file) => file.content.includes(TAG_WRANGLER_NEW_TAG));
  const metadataCalled = hasCalledLedger(input.host, input.plugin.id, [
    'MetadataCache.getCache',
    'MetadataCache.getCachedFiles',
    'MetadataCache.getFileCache',
    'MetadataCache.getTags',
  ]);
  const writeCalled = hasCalledLedger(input.host, input.plugin.id, ['Vault.modify', 'Vault.process']);
  const changedExpectedFiles = changedFixturePaths.length === TAG_WRANGLER_FIXTURE_PATHS.length && unexpectedChanges.length === 0;
  const observable = observableEvidence(result.action, result.changes);
  const passed = frontmatterRenamed
    && bodyRenamed
    && oldTagGone
    && newTagPresent
    && changedExpectedFiles
    && result.entrypointAssertions.every((assertion) => assertion.passed)
    && metadataCalled
    && writeCalled;

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      ...result.entrypointEvidence,
      `Fixture rename ${TAG_WRANGLER_OLD_TAG} -> ${TAG_WRANGLER_NEW_TAG}.`,
      ...observable,
      ...(!changedExpectedFiles ? [`Unexpected fixture write scope: changed=${Array.from(changedPaths).join(', ') || 'none'}`] : []),
    ],
    assertions: [
      ...result.entrypointAssertions,
      { id: 'frontmatter-tags-renamed', label: 'Renamed tags in YAML frontmatter', passed: frontmatterRenamed },
      { id: 'body-tags-renamed', label: 'Renamed inline body tags', passed: bodyRenamed },
      { id: 'old-tag-removed', label: 'Removed the old tag from every fixture note', passed: oldTagGone },
      { id: 'new-tag-present', label: 'Inserted the new tag in every fixture note', passed: newTagPresent },
      { id: 'fixture-write-scope', label: 'Only the Tag Wrangler fixture notes changed', passed: changedExpectedFiles, detail: Array.from(changedPaths).join(', ') || 'No changed files.' },
      { id: 'metadata-cache-called-ledger', label: 'Recorded metadata cache lookup evidence', passed: metadataCalled },
      { id: 'vault-write-called-ledger', label: 'Recorded vault write evidence', passed: writeCalled },
    ],
    ...(!passed ? { failureReason: tagWranglerFailureReason({
      entrypointFailures: result.entrypointFailures,
      renameContinuationHint: result.entrypointAssertions.some((assertion) => assertion.id === 'menu-item-executed' && assertion.passed) && !writeCalled,
      frontmatterRenamed,
      bodyRenamed,
      oldTagGone,
      newTagPresent,
      changedExpectedFiles,
      metadataCalled,
      writeCalled,
    }) } : {}),
  };
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
  const nativeSnapshot = nativeAdmonitionCalloutSnapshot();
  const renders = await input.host.renderMarkdownPostProcessors(ADMONITION_MARKDOWN_FIXTURE, 'workflow-probes/admonition.md');
  const ownRenders = renders.filter((render) => render.pluginId === input.plugin.id);
  const visibleOutputs = ownRenders
    .filter((render) => Boolean(render.text.trim()) && !render.error)
    .map((render) => render.text);
  const visible = visibleOutputs.length > 0;
  const called = hasCalledLedger(input.host, input.plugin.id, ['registerMarkdownPostProcessor']);
  const alignedWithNative = visibleOutputs.some((text) => snapshotsSemanticallyAlign(text, nativeSnapshot));
  const passed = visible && called && alignedWithNative;
  if (ownRenders.length === 0) {
    return skippedDraft('No Admonition Markdown post processor was available; prefer MindOS native callout rendering until a processor is registered.');
  }
  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Native callout snapshot: ${nativeSnapshot.text}`,
      ...ownRenders.map((render) => render.error ? `Processor failed: ${render.error}` : `Processor output: ${render.text.slice(0, 160)}`),
      ...(!alignedWithNative ? ['Plugin processor output did not match the native callout type/content snapshot.'] : []),
    ],
    assertions: [
      { id: 'render-markdown', label: 'Rendered an Admonition Markdown fixture', passed: visible },
      { id: 'native-callout-snapshot', label: 'Generated the MindOS native callout comparison snapshot', passed: Boolean(nativeSnapshot.normalizedText), detail: nativeSnapshot.markdown },
      { id: 'plugin-native-snapshot-alignment', label: 'Plugin processor output matches native callout semantics', passed: alignedWithNative },
      { id: 'runtime-called-ledger', label: 'Recorded called runtime ledger evidence', passed: called },
    ],
    ...(!passed ? { failureReason: admonitionFailureReason({ visible, called, alignedWithNative }) } : {}),
  };
}

async function runRecentFilesProbe(input: WorkflowProbeRuntimeInput): Promise<WorkflowProbeDraft> {
  const command = selectCommand(input.plugin, [/recent/i, /file/i, /open/i]);
  const view = input.plugin.runtime.viewList?.find((item) => /recent/i.test(item.type))
    ?? input.plugin.runtime.viewList?.[0];
  if (!command || !view) {
    return skippedDraft('No executable Recent Files command and registered view were available to probe.');
  }
  const expectedRows = readRecentFilesDataRows(input.mindRoot, input.plugin.id);
  if (expectedRows.length === 0) {
    return skippedDraft('No data.json-backed Recent Files rows were available; seed recentFiles data before marking this workflow observed.');
  }

  const action = await input.host.executeCommand(command.fullId);
  const snapshot = await input.host.renderView(input.plugin.id, view.type);
  const text = [snapshot.displayText, snapshot.text].filter(Boolean).join(' ').trim();
  const normalizedText = normalizeSnapshotText(text);
  const renderedRow = expectedRows.find((row) => (
    normalizeSnapshotText(row.basename) && normalizedText.includes(normalizeSnapshotText(row.basename))
  ));
  const commandCalled = hasCalledLedger(input.host, input.plugin.id, ['addCommand']);
  const viewCalled = hasCalledLedger(input.host, input.plugin.id, ['registerView']);
  const visible = Boolean(text);
  const rowRendered = Boolean(renderedRow);
  const passed = commandCalled && viewCalled && visible && rowRendered;
  const observable = observableEvidence(action, []);

  return {
    status: passed ? 'passed' : 'failed',
    evidence: [
      `Executed Recent Files command "${command.name}" (${command.fullId}).`,
      `Rendered Recent Files view "${view.type}": ${text.slice(0, 160) || '(empty)'}.`,
      renderedRow
        ? `Observed Recent Files data row "${renderedRow.basename}" (${renderedRow.path}).`
        : `Expected Recent Files data rows were not visible: ${expectedRows.map((row) => row.basename).join(', ')}.`,
      ...observable,
    ],
    assertions: [
      { id: 'execute-command', label: 'Executed the selected Recent Files command', passed: true, detail: command.fullId },
      { id: 'render-view', label: 'Rendered the Recent Files view snapshot', passed: visible, detail: view.type },
      { id: 'recent-file-row', label: 'Rendered a data.json-backed recent file row', passed: rowRendered, detail: renderedRow?.basename ?? expectedRows.map((row) => row.basename).join(', ') },
      { id: 'command-called-ledger', label: 'Recorded command execution evidence', passed: commandCalled },
      { id: 'view-called-ledger', label: 'Recorded view snapshot evidence', passed: viewCalled },
    ],
    ...(!passed ? { failureReason: recentFilesFailureReason({ commandCalled, viewCalled, visible, rowRendered }) } : {}),
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

function selectCalendarView(plugin: ObsidianWorkflowProbePlugin): { type: string } | undefined {
  const views = plugin.runtime.viewList ?? [];
  return views.find((view) => view.type === CALENDAR_WORKFLOW_PROBE_FIXTURE.viewType)
    ?? views.find((view) => /calendar/i.test(view.type))
    ?? views[0];
}

function selectPeriodicNotesDailyCommand(plugin: ObsidianWorkflowProbePlugin): ObsidianWorkflowProbeCommand | undefined {
  const commands = plugin.runtime.commandList.filter((command) => command.executable !== false);
  return commands.find((command) => (
    command.id === PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.commandId
    || command.fullId.endsWith(`:${PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.commandId}`)
    || command.name === PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.commandName
  ));
}

function selectHomepageOpenCommand(plugin: ObsidianWorkflowProbePlugin): ObsidianWorkflowProbeCommand | undefined {
  const commands = plugin.runtime.commandList.filter((command) => command.executable !== false);
  return commands.find((command) => (
    command.id === HOMEPAGE_WORKFLOW_PROBE_FIXTURE.commandId
    || command.fullId.endsWith(`:${HOMEPAGE_WORKFLOW_PROBE_FIXTURE.commandId}`)
    || command.name === HOMEPAGE_WORKFLOW_PROBE_FIXTURE.commandName
  ));
}

function selectQuickAddChoiceCommand(plugin: ObsidianWorkflowProbePlugin): ObsidianWorkflowProbeCommand | undefined {
  const commands = plugin.runtime.commandList.filter((command) => command.executable !== false);
  return commands.find((command) => isQuickAddFixtureCommand(command, QUICKADD_WORKFLOW_PROBE_FIXTURE))
    ?? commands.find((command) => isQuickAddChoiceCommand(command) && /capture|macro|quickadd|add|mindos/i.test([
      command.id,
      command.fullId,
      command.name,
    ].join(' ')))
    ?? commands.find(isQuickAddChoiceCommand);
}

function selectQuickAddTemplateChoiceCommand(plugin: ObsidianWorkflowProbePlugin): ObsidianWorkflowProbeCommand | undefined {
  const commands = plugin.runtime.commandList.filter((command) => command.executable !== false);
  return commands.find((command) => isQuickAddFixtureCommand(command, QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE));
}

function isQuickAddChoiceCommand(command: ObsidianWorkflowProbeCommand): boolean {
  return command.id.startsWith('choice:')
    || /(^|:)choice:[^:]+$/.test(command.fullId);
}

function isQuickAddFixtureCommand(command: ObsidianWorkflowProbeCommand, fixture: QuickAddFixtureCommandSpec): boolean {
  const commandId = `choice:${fixture.choiceId}`;
  return command.id === commandId
    || command.fullId === `quickadd:${commandId}`
    || command.fullId.endsWith(`:${commandId}`)
    || command.name === fixture.choiceName;
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

interface TagWranglerMenuChoice {
  menuId: string;
  interactionId: string;
  itemIndex: number;
  title: string;
}

interface TagWranglerTextPromptChoice {
  modalId: string;
  interactionId: string;
  title: string;
}

function selectTagWranglerRenameMenuItem(action: PluginActionResult): TagWranglerMenuChoice | null {
  for (const menu of action.menuSnapshots) {
    if (!menu.interactionId) continue;
    const item = menu.items.find((candidate) => (
      candidate.canRun === true
      && /rename/i.test(candidate.title)
      && (
        candidate.title.includes(TAG_WRANGLER_OLD_TAG)
        || candidate.title.includes(TAG_WRANGLER_OLD_TAG_NAME)
        || /tag/i.test(candidate.title)
      )
    ));
    if (!item) continue;
    return {
      menuId: menu.id,
      interactionId: menu.interactionId,
      itemIndex: item.index,
      title: item.title,
    };
  }
  return null;
}

function selectTagWranglerRenameTextPrompt(action: PluginActionResult): TagWranglerTextPromptChoice | null {
  for (const modal of action.modalSnapshots) {
    if (!modal.interactionId || !modal.textInput) continue;
    const title = modal.title || modal.placeholder || 'Plugin text prompt';
    const promptText = [title, modal.text, modal.placeholder].filter(Boolean).join(' ');
    if (!/(renam|tag)/i.test(promptText)) continue;
    return {
      modalId: modal.id,
      interactionId: modal.interactionId,
      title,
    };
  }
  return null;
}

function mergePluginActionResults(first: PluginActionResult, second: PluginActionResult | null): PluginActionResult {
  if (!second) return first;
  const noticeSnapshots = [
    ...(first.noticeSnapshots ?? []),
    ...(second.noticeSnapshots ?? []),
  ];
  const editorUpdates = [
    ...(first.editorUpdates ?? []),
    ...(second.editorUpdates ?? []),
  ];
  return {
    workspaceOpenRequests: [...first.workspaceOpenRequests, ...second.workspaceOpenRequests],
    modalSnapshots: [...first.modalSnapshots, ...second.modalSnapshots],
    menuSnapshots: [...first.menuSnapshots, ...second.menuSnapshots],
    ...(noticeSnapshots.length > 0 ? { noticeSnapshots } : {}),
    ...(editorUpdates.length > 0 ? { editorUpdates } : {}),
  };
}

function tagWranglerFixtureCursorOffset(): number {
  return TAG_WRANGLER_FIXTURE_FILES[0]?.content.indexOf(TAG_WRANGLER_OLD_TAG) ?? 0;
}

interface TagWranglerFixtureFile {
  path: string;
  content: string;
}

function writeTagWranglerFixture(mindRoot: string): void {
  for (const fixture of TAG_WRANGLER_FIXTURE_FILES) {
    writeVaultFile(mindRoot, fixture.path, fixture.content);
  }
}

function readTagWranglerFixture(mindRoot: string): TagWranglerFixtureFile[] {
  return TAG_WRANGLER_FIXTURE_PATHS.map((filePath) => ({
    path: filePath,
    content: readVaultFile(mindRoot, filePath),
  }));
}

function frontmatterTagRenamed(content: string): boolean {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter?.[1]) return false;
  return frontmatter[1].includes(TAG_WRANGLER_NEW_TAG_NAME)
    && !frontmatter[1].includes(TAG_WRANGLER_OLD_TAG_NAME);
}

function bodyTagRenamed(content: string): boolean {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, '');
  return body.includes(TAG_WRANGLER_NEW_TAG)
    && !body.includes(TAG_WRANGLER_OLD_TAG);
}

function tagWranglerFailureReason(input: {
  entrypointFailures?: string[];
  renameContinuationHint?: boolean;
  frontmatterRenamed: boolean;
  bodyRenamed: boolean;
  oldTagGone: boolean;
  newTagPresent: boolean;
  changedExpectedFiles: boolean;
  metadataCalled: boolean;
  writeCalled: boolean;
}): string {
  return [
    ...(input.entrypointFailures ?? []),
    input.renameContinuationHint ? 'editor-menu/menu item ran but the rename/write continuation did not complete; the plugin may require text prompt or modal continuation support' : '',
    !input.frontmatterRenamed ? 'frontmatter tags were not renamed in every fixture note' : '',
    !input.bodyRenamed ? 'inline body tags were not renamed in every fixture note' : '',
    !input.oldTagGone ? 'old tag remains in at least one fixture note' : '',
    !input.newTagPresent ? 'new tag missing from at least one fixture note' : '',
    !input.changedExpectedFiles ? 'changed files did not match the controlled Tag Wrangler fixture set' : '',
    !input.metadataCalled ? 'runtime ledger did not record metadata cache lookup evidence' : '',
    !input.writeCalled ? 'runtime ledger did not record vault write evidence' : '',
  ].filter(Boolean).join('; ');
}

function changedVaultPaths(changes: string[]): Set<string> {
  const result = new Set<string>();
  for (const change of changes) {
    const match = change.match(/^(.+) (?:created|changed|deleted)$/);
    if (match?.[1]) result.add(match[1]);
  }
  return result;
}

interface NativeAdmonitionSnapshot {
  type: string;
  body: string;
  markdown: string;
  text: string;
  normalizedText: string;
}

function nativeAdmonitionCalloutSnapshot(): NativeAdmonitionSnapshot {
  const lines = ADMONITION_NATIVE_CALLOUT_FIXTURE.split(/\r?\n/);
  const marker = lines[0]?.match(/^>\s*\[!([^\]]+)\]\s*(.*)$/);
  const type = marker?.[1]?.trim().toLowerCase() ?? 'note';
  const title = marker?.[2]?.trim() ?? '';
  const body = lines.slice(1)
    .map((line) => line.replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join('\n');
  const text = [type, title, body].filter(Boolean).join('\n');
  return {
    type,
    body,
    markdown: ADMONITION_NATIVE_CALLOUT_FIXTURE,
    text,
    normalizedText: normalizeSnapshotText(text),
  };
}

function snapshotsSemanticallyAlign(pluginText: string, nativeSnapshot: NativeAdmonitionSnapshot): boolean {
  const normalized = normalizeSnapshotText(pluginText);
  return normalized.includes(normalizeSnapshotText(nativeSnapshot.type))
    && normalized.includes(normalizeSnapshotText(nativeSnapshot.body));
}

function admonitionFailureReason(input: { visible: boolean; called: boolean; alignedWithNative: boolean }): string {
  return [
    !input.visible ? 'Admonition processor did not produce visible snapshot output' : '',
    !input.called ? 'runtime ledger did not record called evidence for the Markdown processor' : '',
    !input.alignedWithNative ? 'processor output did not align with the MindOS native callout snapshot' : '',
  ].filter(Boolean).join('; ');
}

function periodicNotesFailureReason(input: {
  commandCalled: boolean;
  vaultCreateCalled: boolean;
  workspaceCalled: boolean;
  targetChanged: boolean;
  targetExists: boolean;
  targetContentMatches: boolean;
  workspaceOpened: boolean;
}): string {
  return [
    !input.commandCalled ? 'runtime ledger did not record Periodic Notes command execution' : '',
    !input.vaultCreateCalled ? 'runtime ledger did not record Periodic Notes vault create evidence' : '',
    !input.workspaceCalled ? 'runtime ledger did not record Periodic Notes workspace open evidence' : '',
    !input.targetChanged ? 'Periodic Notes daily fixture note was not created or changed' : '',
    !input.targetExists ? 'Periodic Notes daily fixture note does not exist' : '',
    !input.targetContentMatches ? 'Periodic Notes daily fixture note did not contain expected template content' : '',
    !input.workspaceOpened ? 'Periodic Notes did not request opening the daily fixture note' : '',
  ].filter(Boolean).join('; ');
}

function recentFilesFailureReason(input: { commandCalled: boolean; viewCalled: boolean; visible: boolean; rowRendered: boolean }): string {
  return [
    !input.commandCalled ? 'runtime ledger did not record Recent Files command execution' : '',
    !input.viewCalled ? 'runtime ledger did not record Recent Files view rendering' : '',
    !input.visible ? 'Recent Files view rendered without visible snapshot text' : '',
    !input.rowRendered ? 'Recent Files view did not render any data.json-backed recent file row' : '',
  ].filter(Boolean).join('; ');
}

function calendarFailureReason(input: {
  targetContentMatches: boolean;
  workspaceOpened: boolean;
  viewCalled: boolean;
  workspaceCalled: boolean;
}): string {
  return [
    !input.targetContentMatches ? 'Calendar fixture note did not contain expected content' : '',
    !input.workspaceOpened ? 'Calendar did not request opening the daily fixture note' : '',
    !input.viewCalled ? 'runtime ledger did not record Calendar view handler evidence' : '',
    !input.workspaceCalled ? 'runtime ledger did not record Calendar workspace open evidence' : '',
  ].filter(Boolean).join('; ');
}

function homepageFailureReason(input: {
  commandCalled: boolean;
  workspaceCalled: boolean;
  targetExists: boolean;
  targetContentMatches: boolean;
  workspaceOpened: boolean;
}): string {
  return [
    !input.commandCalled ? 'runtime ledger did not record Homepage command execution' : '',
    !input.workspaceCalled ? 'runtime ledger did not record Homepage workspace open evidence' : '',
    !input.targetExists ? 'Homepage fixture note does not exist' : '',
    !input.targetContentMatches ? 'Homepage fixture note did not contain expected content' : '',
    !input.workspaceOpened ? 'Homepage did not request opening the configured fixture note' : '',
  ].filter(Boolean).join('; ');
}

function hasPeriodicNotesDailyFixtureSettings(mindRoot: string, pluginId: string): boolean {
  const location = resolveInstalledObsidianPluginDir(mindRoot, pluginId);
  if (!location) return false;
  const dataPath = path.join(location.pluginDir, 'data.json');
  if (!fs.existsSync(dataPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as { daily?: unknown };
    if (!parsed.daily || typeof parsed.daily !== 'object') return false;
    const daily = parsed.daily as { enabled?: unknown; format?: unknown; folder?: unknown; template?: unknown };
    return daily.enabled === true
      && String(daily.format ?? '').trim() === PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.format
      && normalizeWorkflowPath(String(daily.folder ?? '')) === PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.folder
      && normalizeWorkflowPath(String(daily.template ?? '')) === PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.templatePath;
  } catch {
    return false;
  }
}

function hasCalendarFixtureNote(mindRoot: string): boolean {
  const targetPath = path.join(mindRoot, CALENDAR_WORKFLOW_PROBE_FIXTURE.targetPath);
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return false;
  return fs.readFileSync(targetPath, 'utf-8').includes(CALENDAR_WORKFLOW_PROBE_FIXTURE.expectedContent);
}

function hasHomepageFixtureSettings(mindRoot: string, pluginId: string): boolean {
  const location = resolveInstalledObsidianPluginDir(mindRoot, pluginId);
  if (!location) return false;
  const dataPath = path.join(location.pluginDir, 'data.json');
  if (!fs.existsSync(dataPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as { homepages?: unknown };
    if (!parsed.homepages || typeof parsed.homepages !== 'object' || Array.isArray(parsed.homepages)) return false;
    const homepage = (parsed.homepages as Record<string, unknown>)[HOMEPAGE_WORKFLOW_PROBE_FIXTURE.homepageName];
    if (!homepage || typeof homepage !== 'object' || Array.isArray(homepage)) return false;
    const record = homepage as { value?: unknown; kind?: unknown };
    return record.kind === 'File'
      && (
        workflowPathMatches(String(record.value ?? ''), HOMEPAGE_WORKFLOW_PROBE_FIXTURE.targetPath)
        || workflowPathMatches(String(record.value ?? ''), HOMEPAGE_WORKFLOW_PROBE_FIXTURE.targetLink)
      );
  } catch {
    return false;
  }
}

function readRecentFilesDataRows(mindRoot: string, pluginId: string): Array<{ basename: string; path: string }> {
  const location = resolveInstalledObsidianPluginDir(mindRoot, pluginId);
  if (!location) return [];
  const dataPath = path.join(location.pluginDir, 'data.json');
  if (!fs.existsSync(dataPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as { recentFiles?: unknown };
    if (!Array.isArray(parsed.recentFiles)) return [];
    const rows: Array<{ basename: string; path: string }> = [];
    for (const item of parsed.recentFiles) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { basename?: unknown; path?: unknown };
      const pathValue = typeof record.path === 'string' ? record.path.trim() : '';
      const basenameValue = typeof record.basename === 'string' ? record.basename.trim() : path.basename(pathValue, path.extname(pathValue));
      if (!pathValue || !basenameValue) continue;
      rows.push({ basename: basenameValue, path: pathValue });
    }
    return rows;
  } catch {
    return [];
  }
}

function normalizeSnapshotText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeWorkflowPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

function workflowPathMatches(value: string, targetPath: string): boolean {
  const normalizedValue = normalizeWorkflowPath(value);
  const normalizedTarget = normalizeWorkflowPath(targetPath);
  return normalizedValue === normalizedTarget
    || stripMarkdownExtension(normalizedValue) === stripMarkdownExtension(normalizedTarget);
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, '');
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

function readVaultFile(mindRoot: string, relativePath: string): string {
  return fs.readFileSync(path.join(mindRoot, relativePath), 'utf-8');
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
  'quickadd-template-note',
  'calendar-open-periodic-note',
  'periodic-notes-open-daily-note',
  'homepage-open-note',
  'tag-wrangler-rename',
  'linter-review-apply',
  'admonition-render-markdown',
  'recent-files-open-view',
]);

const QUICKADD_VAULT_WRITE_CAPABILITIES = [
  'Vault.create',
  'Vault.createBinary',
  'Vault.modify',
  'Vault.process',
  'Vault.rename',
];

const PRIVATE_ROOTS = new Set(['.git', '.mindos', '.obsidian', '.plugins', 'node_modules']);
const ADMONITION_MARKDOWN_FIXTURE = '```admonition\nnote\nMindOS workflow probe\n```';
const ADMONITION_NATIVE_CALLOUT_FIXTURE = '> [!note]\n> MindOS workflow probe';
const TAG_WRANGLER_OLD_TAG_NAME = 'mindos/legacy';
const TAG_WRANGLER_NEW_TAG_NAME = 'mindos/renamed';
const TAG_WRANGLER_OLD_TAG = `#${TAG_WRANGLER_OLD_TAG_NAME}`;
const TAG_WRANGLER_NEW_TAG = `#${TAG_WRANGLER_NEW_TAG_NAME}`;
const TAG_WRANGLER_FIXTURE_FILES: TagWranglerFixtureFile[] = [
  {
    path: 'workflow-probes/tag-wrangler/alpha.md',
    content: `---
tags:
  - ${TAG_WRANGLER_OLD_TAG_NAME}
  - keep/tag
---
# Alpha

Primary rename fixture with ${TAG_WRANGLER_OLD_TAG} in prose.
`,
  },
  {
    path: 'workflow-probes/tag-wrangler/beta.md',
    content: `---
tags: [${TAG_WRANGLER_OLD_TAG_NAME}, keep/tag]
---
# Beta

Second rename fixture with ${TAG_WRANGLER_OLD_TAG} and another untouched #keep/tag.
`,
  },
];
const TAG_WRANGLER_FIXTURE_PATHS = TAG_WRANGLER_FIXTURE_FILES.map((fixture) => fixture.path);
