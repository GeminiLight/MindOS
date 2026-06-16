import { describe, expect, it } from 'vitest';
import {
  buildRuntimeComposerPresentation,
  buildRuntimeCompanionOptions,
  buildRuntimeCompanionSummary,
  coerceSelectedRuntime,
  compactRuntimeError,
  selectedRuntimeForOption,
} from '@/lib/agent-runtime-companion';
import type { AgentRuntimesResponse } from '@/lib/types';

describe('agent-runtime-companion', () => {
  it('summarizes reported runtime readiness without inventing mobile-local execution', () => {
    const response: AgentRuntimesResponse = {
      runtimes: [
        { id: 'mindos', name: 'MindOS Agent', kind: 'mindos', status: 'available' },
        {
          id: 'codex',
          name: 'Codex',
          kind: 'codex',
          status: 'available',
          runtimeBridge: {
            kind: 'codex-app-server',
            label: 'Codex app server',
            reason: 'Runs on the connected desktop.',
          },
        },
        { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'missing' },
      ],
    };

    const summary = buildRuntimeCompanionSummary(response);

    expect(summary.statusLabel).toBe('2/4 ready');
    expect(summary.items).toHaveLength(4);
    expect(summary.items.find((item) => item.kind === 'codex')).toMatchObject({
      available: true,
      mobileHint: 'Runs on the connected desktop.',
      bridgeLabel: 'Codex app server',
      statusLabel: 'Ready',
      tone: 'success',
    });
    expect(summary.items.find((item) => item.kind === 'claude')).toMatchObject({
      available: false,
      statusLabel: 'Not found',
      tone: 'muted',
    });
    expect(summary.detail).toContain('control surface');
  });

  it('keeps unreported runtimes visible as setup targets', () => {
    const summary = buildRuntimeCompanionSummary({
      runtimes: [
        { id: 'mindos', name: 'MindOS Agent', kind: 'mindos', status: 'available' },
      ],
    });

    expect(summary.statusLabel).toBe('1/4 ready');
    expect(summary.items.find((item) => item.kind === 'claude')).toMatchObject({
      reported: false,
      status: 'unknown',
      statusLabel: 'Not reported',
    });
  });

  it('surfaces sign-in and runtime errors as warning/error states', () => {
    const summary = buildRuntimeCompanionSummary({
      runtimes: [
        { id: 'mindos', name: 'MindOS Agent', kind: 'mindos', status: 'available' },
        { id: 'codex', name: 'Codex', kind: 'codex', status: 'signed-out' },
        {
          id: 'claude',
          name: 'Claude Code',
          kind: 'claude',
          status: 'error',
          availability: {
            checkedAt: '2026-06-16T00:00:00.000Z',
            sources: ['native-health'],
            diagnosticHints: ['Claude Code SDK failed to start.'],
          },
        },
      ],
    });

    expect(summary.items.find((item) => item.kind === 'codex')).toMatchObject({
      statusLabel: 'Sign in',
      tone: 'warning',
    });
    expect(summary.items.find((item) => item.kind === 'claude')).toMatchObject({
      statusLabel: 'Needs attention',
      tone: 'error',
      diagnosticHint: 'Claude Code SDK failed to start.',
    });
    expect(summary.detail).toContain('needs attention');
  });

  it('compacts noisy runtime fetch errors for mobile UI', () => {
    expect(compactRuntimeError(new Error('Agent runtime detection timed out after 5000ms.'))).toBe(
      'Runtime status check timed out. Pull to retry.',
    );
    expect(compactRuntimeError(new Error('Unauthorized'))).toBe(
      'Runtime status requires a valid access token.',
    );
    expect(compactRuntimeError(new Error('x'.repeat(140)))).toHaveLength(96);
  });

  it('keeps the settings summary separate from chat routing selection', () => {
    const summary = buildRuntimeCompanionSummary({
      runtimes: [
        { id: 'codex', name: 'Codex', kind: 'codex', status: 'available' },
        { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' },
      ],
    });

    expect(summary.items.find((item) => item.kind === 'codex')).toMatchObject({
      available: true,
      mobileRole: 'Host coding agent',
    });
    expect(summary.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ selectedRuntime: expect.anything() })]),
    );
  });

  it('builds chat runtime options that route MindOS as null and external runtimes by identity', () => {
    const options = buildRuntimeCompanionOptions({
      runtimes: [
        { id: 'acp-reviewer', name: 'Reviewer', kind: 'acp', status: 'available' },
        { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'missing' },
        { id: 'codex', name: 'Codex', kind: 'codex', status: 'available' },
      ],
    });

    expect(options.map((item) => item.id)).toEqual(['mindos', 'codex', 'claude', 'acp-reviewer']);
    expect(selectedRuntimeForOption(options[0])).toBeNull();
    expect(options.find((item) => item.id === 'codex')).toMatchObject({
      selectable: true,
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    });
    expect(options.find((item) => item.id === 'claude')).toMatchObject({
      selectable: false,
      selectedRuntime: null,
      statusLabel: 'Not found',
    });
  });

  it('shows unreported external runtime options but keeps them disabled', () => {
    const options = buildRuntimeCompanionOptions(null);

    expect(options.map((item) => item.id)).toEqual(['mindos', 'codex', 'claude', 'acp']);
    expect(options.find((item) => item.id === 'mindos')).toMatchObject({
      selectable: true,
      selectedRuntime: null,
      statusLabel: 'Ready',
    });
    expect(options.find((item) => item.id === 'codex')).toMatchObject({
      selectable: false,
      selectedRuntime: null,
      status: 'unknown',
      statusLabel: 'Not reported',
    });
  });

  it('falls back to MindOS when a selected external runtime becomes unavailable', () => {
    expect(coerceSelectedRuntime(
      { id: 'codex', name: 'Codex', kind: 'codex' },
      { runtimes: [{ id: 'codex', name: 'Codex', kind: 'codex', status: 'error' }] },
    )).toBeNull();
  });

  it('builds a MindOS composer state with agent-mode operations available on the host', () => {
    const options = buildRuntimeCompanionOptions({
      runtimes: [{ id: 'mindos', name: 'MindOS Agent', kind: 'mindos', status: 'available' }],
    });

    const presentation = buildRuntimeComposerPresentation(options[0], 'agent');

    expect(presentation).toMatchObject({
      agentModeEnabled: true,
      placeholder: 'Ask MindOS to act...',
      emptyTitle: 'Run MindOS Agent',
    });
    expect(presentation.modeHint).toContain('subagents');
    expect(presentation.suggestions).toContain('Use subagents to research');
  });

  it('builds Codex composer copy that keeps mobile framed as a host control surface', () => {
    const options = buildRuntimeCompanionOptions({
      runtimes: [{ id: 'codex', name: 'Codex', kind: 'codex', status: 'available' }],
    });
    const codex = options.find((item) => item.kind === 'codex');

    const presentation = buildRuntimeComposerPresentation(codex, 'agent');

    expect(presentation).toMatchObject({
      agentModeEnabled: true,
      placeholder: 'Ask Codex to act...',
      emptyTitle: 'Run Codex on host',
    });
    expect(presentation.modeHint).toContain('host-side coding tools');
    expect(presentation.modeHint).toContain('pending-request bridge');
  });

  it('does not expose agent mode for a runtime option that cannot be selected', () => {
    const options = buildRuntimeCompanionOptions({
      runtimes: [{ id: 'claude', name: 'Claude Code', kind: 'claude', status: 'missing' }],
    });
    const claude = options.find((item) => item.kind === 'claude');

    expect(buildRuntimeComposerPresentation(claude, 'agent')).toMatchObject({
      agentModeEnabled: false,
      placeholder: 'Ask Claude Code to act...',
    });
  });
});
