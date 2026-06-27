import type { ObsidianCapabilityGateReport } from './capability-gate';
import type {
  ObsidianCapabilityCoverage,
  ObsidianCapabilitySurface,
} from './capability-matrix';
import type { ObsidianRuntimeCapabilityLedgerEntry } from './compatibility-preview';
import type { ObsidianRuntimeCapabilityLedgerHistory } from './runtime-capability-ledger-store';
import {
  workflowAuditFromProbeResult,
  type ObsidianWorkflowProbeHistory,
  type ObsidianWorkflowProbeId,
  type ObsidianWorkflowProbeStatus,
} from './workflow-probes';
import { OBSIDIAN_NATIVE_QUERY_INDEX_PROOF_SUMMARY } from './native-query-index';

export type ObsidianWorkflowAuditStatus =
  | 'observed'
  | 'partial'
  | 'blocked'
  | 'native-replacement'
  | 'not-observed';

export type ObsidianWorkflowAuditSource =
  | 'runtime-ledger'
  | 'workflow-probe'
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
  lastProbedAt?: string;
  lastProbeStatus?: ObsidianWorkflowProbeStatus;
  probeFailureReason?: string;
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
  workflowProbeHistory?: ObsidianWorkflowProbeHistory;
}

const DATAVIEW_PLUGIN_IDS = new Set(['dataview']);
const TASKS_PLUGIN_IDS = new Set(['obsidian-tasks-plugin', 'tasks', 'obsidian-tasks']);
const LINTER_PLUGIN_IDS = new Set(['obsidian-linter']);
const QUICKADD_PLUGIN_IDS = new Set(['quickadd']);
const TAG_WRANGLER_PLUGIN_IDS = new Set(['tag-wrangler']);
const CALENDAR_PLUGIN_IDS = new Set(['calendar', 'obsidian-calendar-plugin']);
const ADMONITION_PLUGIN_IDS = new Set(['obsidian-admonition', 'admonition']);
const RECENT_FILES_PLUGIN_IDS = new Set(['recent-files-obsidian']);
const HOMEPAGE_PLUGIN_IDS = new Set(['homepage']);

export function buildObsidianWorkflowAudits(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit[] {
  const pluginId = input.pluginId.toLowerCase();
  const audits: ObsidianWorkflowAudit[] = [];

  if (LINTER_PLUGIN_IDS.has(pluginId)) audits.push(buildLinterAudit(input));
  if (QUICKADD_PLUGIN_IDS.has(pluginId)) audits.push(...buildQuickAddAudits(input));
  if (TAG_WRANGLER_PLUGIN_IDS.has(pluginId)) audits.push(buildTagWranglerAudit(input));
  if (CALENDAR_PLUGIN_IDS.has(pluginId)) audits.push(buildCalendarAudit(input));
  if (ADMONITION_PLUGIN_IDS.has(pluginId)) audits.push(buildAdmonitionAudit(input));
  if (RECENT_FILES_PLUGIN_IDS.has(pluginId)) audits.push(buildRecentFilesAudit(input));
  if (HOMEPAGE_PLUGIN_IDS.has(pluginId)) audits.push(buildHomepageAudit(input));
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
      status: 'partial',
      source: 'runtime-ledger',
      evidence: evidenceFor(observedRuntime),
      lastObservedAt: observedRuntime[0]?.recordedAt,
      nextStep: 'Promote repeated runtime interactions into a named MindOS workflow audit when the user workflow is clear.',
    }];
  }

  return [];
}

function buildLinterAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'linter-review-apply');
  if (probed) return probed;
  const called = latestEntries(input, { capabilities: ['addCommand'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand', 'registerEditorExtension'], phases: ['registered'] });
  if (called.length > 0) {
    return partialAudit('linter-review-apply', 'Review and apply Markdown lint fixes', 'runtime-ledger', called, 'Run the workflow probe and verify preview/apply/undo output before calling this workflow observed.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'linter-review-apply', 'Review and apply Markdown lint fixes');
  if (registered.length > 0) {
    return partialAudit('linter-review-apply', 'Review and apply Markdown lint fixes', 'runtime-ledger', registered, 'Run a lint command from a Markdown source editor and verify preview/apply/undo output.');
  }
  return staticAudit(input, 'linter-review-apply', 'Review and apply Markdown lint fixes', ['commands', 'editor'], 'Import settings, load the plugin, then verify the native MindOS Linter adapter path.');
}

function buildQuickAddAudits(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit[] {
  const audits = [buildQuickAddCaptureAudit(input)];
  const templateAudit = probedAudit(input, 'quickadd-template-note');
  if (templateAudit) audits.push(templateAudit);
  return audits;
}

function buildQuickAddCaptureAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'quickadd-capture-macro');
  if (probed) return probed;
  const called = latestEntries(input, { capabilities: ['addCommand', 'Modal', 'SuggestModal', 'Menu', 'MenuItem'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand'], phases: ['registered'] });
  if (called.length > 0) {
    return partialAudit('quickadd-capture-macro', 'Run capture or macro commands', 'runtime-ledger', called, 'Run the workflow probe and verify real note writes, modal choices, or rollback behavior before calling this workflow observed.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'quickadd-capture-macro', 'Run capture or macro commands');
  if (registered.length > 0) {
    return partialAudit('quickadd-capture-macro', 'Run capture or macro commands', 'runtime-ledger', registered, 'Execute each registered QuickAdd command and inspect modal/menu continuation results.');
  }
  return staticAudit(input, 'quickadd-capture-macro', 'Run capture or macro commands', ['commands', 'settings', 'vault'], 'Load after capability review, then audit command execution plus generated note output.');
}

function buildTagWranglerAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'tag-wrangler-rename');
  if (probed) return probed;
  const called = latestEntries(input, { surfaces: ['metadata', 'vault', 'workspace'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand', 'Workspace.on', 'Workspace.editor-menu', 'Menu'], phases: ['registered', 'called'] });
  if (called.length > 0) {
    return partialAudit('tag-wrangler-rename', 'Rename or organize tags', 'runtime-ledger', called, 'Run the workflow probe against a fixture note set before calling tag rename compatible.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'tag-wrangler-rename', 'Rename or organize tags');
  if (registered.length > 0) {
    return partialAudit('tag-wrangler-rename', 'Rename or organize tags', 'runtime-ledger', registered, 'Run the tag command or editor-menu probe against a fixture note set before calling this workflow compatible.');
  }
  return staticAudit(input, 'tag-wrangler-rename', 'Rename or organize tags', ['metadata', 'vault'], 'Keep this on review until metadata and write-path probes prove the full rename workflow.');
}

function buildCalendarAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'calendar-open-periodic-note');
  if (probed) return probed;
  const called = latestEntries(input, { capabilities: ['registerView', 'Workspace.openLinkText'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['registerView', 'addCommand'], phases: ['registered'] });
  if (called.length > 0) {
    return partialAudit('calendar-open-periodic-note', 'Open calendar views and notes', 'runtime-ledger', called, 'Run the workflow probe and verify date navigation against MindOS note paths before calling this workflow observed.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'calendar-open-periodic-note', 'Open calendar views and notes');
  if (registered.length > 0) {
    return partialAudit('calendar-open-periodic-note', 'Open calendar views and notes', 'runtime-ledger', registered, 'Run the Calendar date-navigation probe against an existing daily note fixture before calling this workflow observed.');
  }
  return staticAudit(input, 'calendar-open-periodic-note', 'Open calendar views and notes', ['views', 'workspace'], 'Catalog the view first, then map date navigation to a MindOS native periodic-note route.');
}

function buildAdmonitionAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'admonition-render-markdown');
  if (probed) return probed;
  const called = latestEntries(input, { capabilities: ['registerMarkdownPostProcessor', 'registerMarkdownCodeBlockProcessor'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['registerMarkdownPostProcessor', 'registerMarkdownCodeBlockProcessor'], phases: ['registered'] });
  if (called.length > 0) {
    return partialAudit('admonition-render-markdown', 'Render admonition blocks', 'runtime-ledger', called, 'Run a Markdown fixture through the workflow probe and compare output snapshots before exposing it as observed.');
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

function buildRecentFilesAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'recent-files-open-view');
  if (probed) return probed;
  const called = latestEntries(input, { capabilities: ['addCommand', 'registerView'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand', 'registerView'], phases: ['registered'] });
  if (called.length > 0) {
    return partialAudit('recent-files-open-view', 'Open recent files view', 'runtime-ledger', called, 'Run the Recent Files workflow probe and verify the command opens a bounded view snapshot before marking the workflow observed.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'recent-files-open-view', 'Open recent files view');
  if (registered.length > 0) {
    return partialAudit('recent-files-open-view', 'Open recent files view', 'runtime-ledger', registered, 'Execute the recent-files command and render the registered view through the snapshot host.');
  }
  return staticAudit(input, 'recent-files-open-view', 'Open recent files view', ['commands', 'views', 'workspace'], 'Load the plugin, execute the recent-files command, then verify the view snapshot output.');
}

function buildHomepageAudit(input: BuildObsidianWorkflowAuditsInput): ObsidianWorkflowAudit {
  const probed = probedAudit(input, 'homepage-open-note');
  if (probed) return probed;
  const called = latestEntries(input, { capabilities: ['addCommand', 'Workspace.openLinkText'], phases: ['called'] });
  const registered = latestEntries(input, { capabilities: ['addCommand'], phases: ['registered'] });
  if (called.length > 0) {
    return partialAudit('homepage-open-note', 'Open configured homepage note', 'runtime-ledger', called, 'Run the Homepage workflow probe and verify a data.json-backed File homepage opens the configured MindOS note before marking the workflow observed.');
  }
  if (input.capabilityGate.blocked) return blockedAudit(input, 'homepage-open-note', 'Open configured homepage note');
  if (registered.length > 0) {
    return partialAudit('homepage-open-note', 'Open configured homepage note', 'runtime-ledger', registered, 'Execute the open-homepage command against a controlled Homepage data.json File fixture.');
  }
  return staticAudit(input, 'homepage-open-note', 'Open configured homepage note', ['commands', 'settings', 'workspace'], 'Load the plugin, seed a File homepage data.json fixture, then verify the command produces a workspace open request.');
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
      OBSIDIAN_NATIVE_QUERY_INDEX_PROOF_SUMMARY,
    ],
    nextStep,
  };
}

function probedAudit(input: BuildObsidianWorkflowAuditsInput, id: ObsidianWorkflowProbeId): ObsidianWorkflowAudit | null {
  const result = input.workflowProbeHistory?.latestById[id];
  return result ? workflowAuditFromProbeResult(result) : null;
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
