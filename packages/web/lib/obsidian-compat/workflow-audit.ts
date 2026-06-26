import type { ObsidianCapabilityGateReport } from './capability-gate';
import type {
  ObsidianCapabilityCoverage,
  ObsidianCapabilitySurface,
} from './capability-matrix';
import type { ObsidianRuntimeCapabilityLedgerEntry } from './compatibility-preview';
import type { ObsidianRuntimeCapabilityLedgerHistory } from './runtime-capability-ledger-store';

export type ObsidianWorkflowAuditStatus =
  | 'observed'
  | 'partial'
  | 'blocked'
  | 'native-replacement'
  | 'not-observed';

export type ObsidianWorkflowAuditSource =
  | 'runtime-ledger'
  | 'capability-gate'
  | 'static-preview'
  | 'native-replacement';

export interface ObsidianWorkflowAudit {
  id: string;
  label: string;
  status: ObsidianWorkflowAuditStatus;
  source: ObsidianWorkflowAuditSource;
  evidence: string[];
  lastObservedAt?: string;
  blockedReasons?: string[];
  nextStep?: string;
}

export interface BuildObsidianWorkflowAuditsInput {
  pluginId: string;
  pluginName: string;
  coverage: ObsidianCapabilityCoverage[];
  capabilityGate: ObsidianCapabilityGateReport;
  runtimeEntries: ObsidianRuntimeCapabilityLedgerEntry[];
  history: ObsidianRuntimeCapabilityLedgerHistory;
}

const DATAVIEW_PLUGIN_IDS = new Set(['dataview']);
const TASKS_PLUGIN_IDS = new Set(['obsidian-tasks-plugin', 'tasks', 'obsidian-tasks']);
const LINTER_PLUGIN_IDS = new Set(['obsidian-linter']);
const QUICKADD_PLUGIN_IDS = new Set(['quickadd']);
const TAG_WRANGLER_PLUGIN_IDS = new Set(['tag-wrangler']);
const CALENDAR_PLUGIN_IDS = new Set(['calendar', 'obsidian-calendar-plugin']);
const ADMONITION_PLUGIN_IDS = new Set(['obsidian-admonition', 'admonition']);

export function buildObsidianWorkflowAudits(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit[] {
  const pluginId = input.pluginId.toLowerCase();
  const audits: ObsidianWorkflowAudit[] = [];

  if (LINTER_PLUGIN_IDS.has(pluginId)) audits.push(buildLinterAudit(input));
  if (QUICKADD_PLUGIN_IDS.has(pluginId)) audits.push(buildQuickAddAudit(input));
  if (TAG_WRANGLER_PLUGIN_IDS.has(pluginId)) audits.push(buildTagWranglerAudit(input));
  if (CALENDAR_PLUGIN_IDS.has(pluginId)) audits.push(buildCalendarAudit(input));
  if (ADMONITION_PLUGIN_IDS.has(pluginId)) audits.push(buildAdmonitionAudit(input));
  if (DATAVIEW_PLUGIN_IDS.has(pluginId)) audits.push(buildNativeReplacementAudit(
    input,
    'dataview-native-query',
    'Query notes and metadata',
    'Route Dataview-style tables, lists, and task views to MindOS native query and retrieval surfaces.',
  ));
  if (TASKS_PLUGIN_IDS.has(pluginId)) audits.push(buildNativeReplacementAudit(
    input,
    'tasks-native-query',
    'Query and update task workflows',
    'Route Tasks-style workflows to MindOS native task/query surfaces before exposing plugin runtime hooks.',
  ));

  if (audits.length > 0) return audits;

  const observedRuntime = latestEntries(input, { phases: ['called'] });
  if (observedRuntime.length > 0) {
    return [{
      id: 'runtime-observed',
      label: 'Runtime interactions',
      status: 'observed',
      source: 'runtime-ledger',
      evidence: evidenceFor(observedRuntime),
      lastObservedAt: observedRuntime[0]?.recordedAt,
      nextStep: 'Promote repeated runtime interactions into a named MindOS workflow audit when the user workflow is clear.',
    }];
  }

  return [];
}

function buildLinterAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const called = latestEntries(input, { capabilities: ['addCommand'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand', 'registerEditorExtension'], phases: ['registered'] });
  if (called.length > 0) {
    return observedAudit('linter-review-apply', 'Review and apply Markdown lint fixes', called, 'Keep mapping high-confidence Linter rules into MindOS-owned preview/apply/undo behavior.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'linter-review-apply', 'Review and apply Markdown lint fixes');
  if (registered.length > 0) {
    return partialAudit('linter-review-apply', 'Review and apply Markdown lint fixes', 'runtime-ledger', registered, 'Run a lint command from a Markdown source editor and verify preview/apply/undo output.');
  }
  return staticAudit(input, 'linter-review-apply', 'Review and apply Markdown lint fixes', ['commands', 'editor'], 'Import settings, load the plugin, then verify the native MindOS Linter adapter path.');
}

function buildQuickAddAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const called = latestEntries(input, { capabilities: ['addCommand', 'Modal', 'SuggestModal', 'Menu', 'MenuItem'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand'], phases: ['registered'] });
  if (called.length > 0) {
    return observedAudit('quickadd-capture-macro', 'Run capture or macro commands', called, 'Verify each capture path with real note writes, modal choices, and rollback behavior.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'quickadd-capture-macro', 'Run capture or macro commands');
  if (registered.length > 0) {
    return partialAudit('quickadd-capture-macro', 'Run capture or macro commands', 'runtime-ledger', registered, 'Execute each registered QuickAdd command and inspect modal/menu continuation results.');
  }
  return staticAudit(input, 'quickadd-capture-macro', 'Run capture or macro commands', ['commands', 'settings', 'vault'], 'Load after capability review, then audit command execution plus generated note output.');
}

function buildTagWranglerAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const called = latestEntries(input, { surfaces: ['metadata', 'vault', 'workspace'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand', 'Menu'], phases: ['registered', 'called'] });
  if (called.length > 0) {
    return observedAudit('tag-wrangler-rename', 'Rename or organize tags', called, 'Verify file rewrites, metadata cache refresh, and undo behavior on a fixture vault.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'tag-wrangler-rename', 'Rename or organize tags');
  if (registered.length > 0) {
    return partialAudit('tag-wrangler-rename', 'Rename or organize tags', 'runtime-ledger', registered, 'Run the tag command against a fixture note set before calling this workflow compatible.');
  }
  return staticAudit(input, 'tag-wrangler-rename', 'Rename or organize tags', ['metadata', 'vault'], 'Keep this on review until metadata and write-path probes prove the full rename workflow.');
}

function buildCalendarAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const called = latestEntries(input, { capabilities: ['registerView', 'Workspace.openLinkText'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['registerView', 'addCommand'], phases: ['registered'] });
  if (called.length > 0) {
    return observedAudit('calendar-open-periodic-note', 'Open calendar views and notes', called, 'Verify date navigation against MindOS note paths and periodic-note naming rules.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'calendar-open-periodic-note', 'Open calendar views and notes');
  if (registered.length > 0) {
    return partialAudit('calendar-open-periodic-note', 'Open calendar views and notes', 'runtime-ledger', registered, 'Render the view or execute the open-note command to confirm navigation behavior.');
  }
  return staticAudit(input, 'calendar-open-periodic-note', 'Open calendar views and notes', ['views', 'workspace'], 'Catalog the view first, then map date navigation to a MindOS native periodic-note route.');
}

function buildAdmonitionAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const called = latestEntries(input, { capabilities: ['registerMarkdownPostProcessor', 'registerMarkdownCodeBlockProcessor'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['registerMarkdownPostProcessor', 'registerMarkdownCodeBlockProcessor'], phases: ['registered'] });
  if (called.length > 0) {
    return observedAudit('admonition-render-markdown', 'Render admonition blocks', called, 'Compare rendered output with MindOS native callouts before exposing it as compatible.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'admonition-render-markdown', 'Render admonition blocks');
  if (registered.length > 0) {
    return partialAudit('admonition-render-markdown', 'Render admonition blocks', 'runtime-ledger', registered, 'Run a Markdown fixture through the document host and compare output snapshots.');
  }
  return {
    id: 'admonition-render-markdown',
    label: 'Render admonition blocks',
    status: 'native-replacement',
    source: 'native-replacement',
    evidence: ['MindOS can cover this workflow with native Markdown callout rendering before mounting arbitrary plugin DOM.'],
    nextStep: 'Prefer native callout rendering unless runtime snapshots prove plugin-specific syntax that MindOS does not cover.',
  };
}

function buildNativeReplacementAudit(
  input: BuildObsidianWorkflowAuditsInput,
  id: string,
  label: string,
  nextStep: string,
): ObsidianWorkflowAudit {
  return {
    id,
    label,
    status: 'native-replacement',
    source: 'native-replacement',
    evidence: [
      `${input.pluginName} is better matched by a MindOS-owned query/index workflow than by broad Obsidian runtime parity.`,
    ],
    nextStep,
  };
}

function observedAudit(
  id: string,
  label: string,
  entries: Array<ObsidianRuntimeCapabilityLedgerEntry & { recordedAt?: string }>,
  nextStep: string,
): ObsidianWorkflowAudit {
  return {
    id,
    label,
    status: 'observed',
    source: 'runtime-ledger',
    evidence: evidenceFor(entries),
    lastObservedAt: entries[0]?.recordedAt,
    nextStep,
  };
}

function partialAudit(
  id: string,
  label: string,
  source: ObsidianWorkflowAuditSource,
  entries: Array<ObsidianRuntimeCapabilityLedgerEntry & { recordedAt?: string }>,
  nextStep: string,
): ObsidianWorkflowAudit {
  return {
    id,
    label,
    status: 'partial',
    source,
    evidence: evidenceFor(entries),
    lastObservedAt: entries[0]?.recordedAt,
    nextStep,
  };
}

function blockedAudit(input: BuildObsidianWorkflowAuditsInput, id: string, label: string): ObsidianWorkflowAudit {
  const reasons = input.capabilityGate.blockedReasons.length > 0
    ? input.capabilityGate.blockedReasons
    : input.capabilityGate.confirmReasons;
  return {
    id,
    label,
    status: 'blocked',
    source: 'capability-gate',
    evidence: reasons.slice(0, 3),
    blockedReasons: reasons,
    nextStep: 'Resolve the blocked capability surface or design a MindOS-native workflow before enabling.',
  };
}

function staticAudit(
  input: BuildObsidianWorkflowAuditsInput,
  id: string,
  label: string,
  surfaces: ObsidianCapabilitySurface[],
  nextStep: string,
): ObsidianWorkflowAudit {
  const matched = input.coverage.filter((item) => surfaces.includes(item.surface)).slice(0, 4);
  if (matched.length === 0) {
    return {
      id,
      label,
      status: 'not-observed',
      source: 'static-preview',
      evidence: ['No runtime evidence has been recorded for this workflow yet.'],
      nextStep,
    };
  }
  return {
    id,
    label,
    status: 'partial',
    source: 'static-preview',
    evidence: matched.map((item) => `Static analysis detected ${item.api} on ${item.surface}.`),
    nextStep,
  };
}

function latestEntries(
  input: BuildObsidianWorkflowAuditsInput,
  filters: {
    capabilities?: string[];
    surfaces?: ObsidianCapabilitySurface[];
    phases?: ObsidianRuntimeCapabilityLedgerEntry['phase'][];
  },
): Array<ObsidianRuntimeCapabilityLedgerEntry & { recordedAt?: string }> {
  const capabilities = new Set(filters.capabilities ?? []);
  const surfaces = new Set(filters.surfaces ?? []);
  const phases = new Set(filters.phases ?? []);
  return [
    ...input.history.entries,
    ...input.runtimeEntries,
  ]
    .filter((entry) => capabilities.size === 0 || capabilities.has(entry.capability))
    .filter((entry) => surfaces.size === 0 || surfaces.has(entry.surface))
    .filter((entry) => phases.size === 0 || phases.has(entry.phase))
    .slice(-5)
    .reverse();
}

function evidenceFor(entries: Array<ObsidianRuntimeCapabilityLedgerEntry & { recordedAt?: string }>): string[] {
  return entries
    .map((entry) => entry.recordedAt ? `${entry.recordedAt}: ${entry.evidence}` : entry.evidence)
    .slice(0, 3);
}
