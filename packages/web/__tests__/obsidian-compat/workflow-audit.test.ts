import { describe, expect, it } from 'vitest';
import type { ObsidianCapabilityGateReport } from '@/lib/obsidian-compat/capability-gate';
import type { ObsidianCapabilityCoverage } from '@/lib/obsidian-compat/capability-matrix';
import type { ObsidianRuntimeCapabilityLedgerEntry } from '@/lib/obsidian-compat/compatibility-preview';
import type { ObsidianRuntimeCapabilityLedgerHistory } from '@/lib/obsidian-compat/runtime-capability-ledger-store';
import { buildObsidianWorkflowAudits } from '@/lib/obsidian-compat/workflow-audit';

const readyGate: ObsidianCapabilityGateReport = {
  status: 'ready',
  fingerprint: 'ready',
  requiresConfirmation: false,
  confirmed: false,
  blocked: false,
  items: [],
  confirmReasons: [],
  blockedReasons: [],
};

function history(entries: Array<ObsidianRuntimeCapabilityLedgerEntry & { recordedAt?: string }> = []): ObsidianRuntimeCapabilityLedgerHistory {
  return {
    total: entries.length,
    entries: entries.map((entry, index) => ({
      schemaVersion: 1,
      sessionId: 'session',
      recordedAt: entry.recordedAt ?? `2026-06-26T00:00:0${index}.000Z`,
      pluginId: entry.pluginId ?? 'quickadd',
      capability: entry.capability,
      surface: entry.surface,
      support: entry.support,
      phase: entry.phase,
      source: 'runtime-ledger',
      evidence: entry.evidence,
    })),
    summary: {
      predicted: 0,
      registered: entries.filter((entry) => entry.phase === 'registered').length,
      called: entries.filter((entry) => entry.phase === 'called').length,
      denied: entries.filter((entry) => entry.phase === 'denied').length,
      blocked: entries.filter((entry) => entry.phase === 'blocked').length,
    },
    latestBlocked: [],
    skippedCorruptLines: 0,
  };
}

function runtimeEntry(overrides: Partial<ObsidianRuntimeCapabilityLedgerEntry> = {}): ObsidianRuntimeCapabilityLedgerEntry {
  return {
    pluginId: 'quickadd',
    capability: 'addCommand',
    surface: 'commands',
    support: 'full',
    phase: 'called',
    source: 'runtime-ledger',
    evidence: 'Plugin command executed.',
    ...overrides,
  };
}

describe('buildObsidianWorkflowAudits', () => {
  it('keeps QuickAdd runtime called evidence partial until a workflow probe proves the result', () => {
    const audits = buildObsidianWorkflowAudits({
      pluginId: 'quickadd',
      pluginName: 'QuickAdd',
      coverage: [],
      capabilityGate: readyGate,
      runtimeEntries: [],
      history: history([runtimeEntry({ recordedAt: '2026-06-26T08:00:00.000Z' })]),
    });

    expect(audits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'partial',
        source: 'runtime-ledger',
        lastObservedAt: '2026-06-26T08:00:00.000Z',
      }),
    ]);
  });

  it('keeps generic runtime called evidence partial until a named workflow is defined', () => {
    const audits = buildObsidianWorkflowAudits({
      pluginId: 'unknown-plugin',
      pluginName: 'Unknown Plugin',
      coverage: [],
      capabilityGate: readyGate,
      runtimeEntries: [],
      history: history([runtimeEntry({
        pluginId: 'unknown-plugin',
        capability: 'requestUrl',
        surface: 'network',
        support: 'limited',
        recordedAt: '2026-06-26T09:00:00.000Z',
        evidence: 'Plugin called requestUrl.',
      })]),
    });

    expect(audits).toEqual([
      expect.objectContaining({
        id: 'runtime-observed',
        status: 'partial',
        source: 'runtime-ledger',
        lastObservedAt: '2026-06-26T09:00:00.000Z',
      }),
    ]);
  });

  it('marks QuickAdd workflows observed when a workflow probe passes with result assertions', () => {
    const audits = buildObsidianWorkflowAudits({
      pluginId: 'quickadd',
      pluginName: 'QuickAdd',
      coverage: [],
      capabilityGate: readyGate,
      runtimeEntries: [],
      history: history([runtimeEntry({ recordedAt: '2026-06-26T08:00:00.000Z' })]),
      workflowProbeHistory: {
        total: 1,
        entries: [{
          schemaVersion: 1,
          pluginId: 'quickadd',
          id: 'quickadd-capture-macro',
          label: 'Run capture or macro commands',
          status: 'passed',
          source: 'workflow-probe',
          startedAt: '2026-06-26T08:00:00.000Z',
          completedAt: '2026-06-26T08:00:01.000Z',
          evidence: ['Probe executed command and observed a vault file write.'],
          assertions: [
            { id: 'execute-command', label: 'Executed command', passed: true },
            { id: 'observable-result', label: 'Observed workflow result', passed: true },
          ],
        }],
        latestById: {
          'quickadd-capture-macro': {
            schemaVersion: 1,
            pluginId: 'quickadd',
            id: 'quickadd-capture-macro',
            label: 'Run capture or macro commands',
            status: 'passed',
            source: 'workflow-probe',
            startedAt: '2026-06-26T08:00:00.000Z',
            completedAt: '2026-06-26T08:00:01.000Z',
            evidence: ['Probe executed command and observed a vault file write.'],
            assertions: [
              { id: 'execute-command', label: 'Executed command', passed: true },
              { id: 'observable-result', label: 'Observed workflow result', passed: true },
            ],
          },
        },
        skippedCorruptLines: 0,
        updatedAt: '2026-06-26T08:00:01.000Z',
      },
    });

    expect(audits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'observed',
        source: 'workflow-probe',
        lastObservedAt: '2026-06-26T08:00:01.000Z',
        lastProbeStatus: 'passed',
        lastProbedAt: '2026-06-26T08:00:01.000Z',
      }),
    ]);
  });

  it('adds the QuickAdd template workflow audit when a template probe has run', () => {
    const captureResult = {
      schemaVersion: 1 as const,
      pluginId: 'quickadd',
      id: 'quickadd-capture-macro' as const,
      label: 'Run capture or macro commands',
      status: 'passed' as const,
      source: 'workflow-probe' as const,
      startedAt: '2026-06-26T08:00:00.000Z',
      completedAt: '2026-06-26T08:00:01.000Z',
      evidence: ['Capture probe observed a vault file write.'],
      assertions: [
        { id: 'execute-command', label: 'Executed command', passed: true },
      ],
    };
    const templateResult = {
      schemaVersion: 1 as const,
      pluginId: 'quickadd',
      id: 'quickadd-template-note' as const,
      label: 'Create note from template choice',
      status: 'passed' as const,
      source: 'workflow-probe' as const,
      startedAt: '2026-06-26T08:01:00.000Z',
      completedAt: '2026-06-26T08:01:01.000Z',
      evidence: ['Template probe created the fixture note.'],
      assertions: [
        { id: 'fixture-template-note-written', label: 'Created fixture note', passed: true },
      ],
    };

    const audits = buildObsidianWorkflowAudits({
      pluginId: 'quickadd',
      pluginName: 'QuickAdd',
      coverage: [],
      capabilityGate: readyGate,
      runtimeEntries: [],
      history: history(),
      workflowProbeHistory: {
        total: 2,
        entries: [captureResult, templateResult],
        latestById: {
          'quickadd-capture-macro': captureResult,
          'quickadd-template-note': templateResult,
        },
        skippedCorruptLines: 0,
        updatedAt: '2026-06-26T08:01:01.000Z',
      },
    });

    expect(audits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'observed',
      }),
      expect.objectContaining({
        id: 'quickadd-template-note',
        status: 'observed',
        source: 'workflow-probe',
        lastObservedAt: '2026-06-26T08:01:01.000Z',
      }),
    ]);
  });

  it('keeps static Linter evidence partial instead of claiming runtime observation', () => {
    const coverage: ObsidianCapabilityCoverage[] = [{
      api: 'addCommand',
      surface: 'commands',
      support: 'full',
      host: 'command-registry',
      notes: 'registered command',
    }];

    const audits = buildObsidianWorkflowAudits({
      pluginId: 'obsidian-linter',
      pluginName: 'Linter',
      coverage,
      capabilityGate: readyGate,
      runtimeEntries: [],
      history: history(),
    });

    expect(audits[0]).toMatchObject({
      id: 'linter-review-apply',
      status: 'partial',
      source: 'static-preview',
    });
  });

  it('routes Dataview to a native replacement audit', () => {
    const audits = buildObsidianWorkflowAudits({
      pluginId: 'dataview',
      pluginName: 'Dataview',
      coverage: [],
      capabilityGate: readyGate,
      runtimeEntries: [],
      history: history(),
    });

    expect(audits).toEqual([
      expect.objectContaining({
        id: 'dataview-native-query',
        status: 'native-replacement',
        source: 'native-replacement',
      }),
    ]);
  });

  it('keeps blocked gate reasons visible in workflow audit', () => {
    const audits = buildObsidianWorkflowAudits({
      pluginId: 'calendar',
      pluginName: 'Calendar',
      coverage: [],
      capabilityGate: {
        ...readyGate,
        status: 'blocked',
        blocked: true,
        blockedReasons: ['Unsupported workspace pane host.'],
      },
      runtimeEntries: [],
      history: history(),
    });

    expect(audits[0]).toMatchObject({
      id: 'calendar-open-periodic-note',
      status: 'blocked',
      source: 'capability-gate',
      blockedReasons: ['Unsupported workspace pane host.'],
    });
  });
});
