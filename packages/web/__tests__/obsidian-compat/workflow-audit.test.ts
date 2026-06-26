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
