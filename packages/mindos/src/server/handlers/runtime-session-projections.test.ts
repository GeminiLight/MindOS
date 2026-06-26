import { describe, expect, it } from 'vitest';
import {
  acpRuntimeDescriptor,
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import type { AcpSessionSnapshot } from '../../protocols/acp/index.js';
import {
  buildRuntimeSessionProjectionsPayload,
  handleRuntimeSessionProjectionsGet,
} from './runtime-session-projections.js';

const CHECKED_AT = '2026-06-26T00:00:00.000Z';

function runtimes() {
  return [
    mindosRuntimeDescriptor(CHECKED_AT),
    nativeDescriptor({
      id: 'codex',
      name: 'Codex',
      checkedAt: CHECKED_AT,
      source: {
        id: 'codex',
        name: 'Codex',
        binaryPath: '/usr/local/bin/codex',
        status: 'available',
      },
    }),
    acpRuntimeDescriptor({
      id: 'declared-acp',
      name: 'Declared ACP',
      binaryPath: '/usr/local/bin/declared-acp',
      status: 'available',
      adapterMetadata: {
        supportsStreaming: true,
        authRequired: false,
        models: [{ id: 'fast', label: 'Fast' }],
        commands: [{ name: 'commit', description: 'Prepare a commit.' }],
      },
    }, CHECKED_AT),
  ];
}

function acpSnapshot(): AcpSessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId: 'ses-declared',
    agentId: 'declared-acp',
    agentSessionId: 'agent-ses-declared',
    state: 'idle',
    cwd: '/repo',
    createdAt: CHECKED_AT,
    lastActivityAt: '2026-06-26T00:01:00.000Z',
    authMethods: [],
    modes: [{ id: 'code', name: 'Code' }],
    currentModeId: 'code',
    configOptions: [],
    controls: {
      model: {
        status: 'available',
        source: 'observed',
        configId: 'model',
        currentValue: 'smart',
        options: [{ id: 'smart', label: 'Smart' }],
      },
      mode: {
        status: 'available',
        source: 'observed',
        currentValue: 'code',
        options: [{ id: 'code', label: 'Code' }],
      },
      thoughtLevel: {
        status: 'available',
        source: 'observed',
        configId: 'reasoning_effort',
        currentValue: 'high',
        options: [{ id: 'high', label: 'High' }],
      },
    },
    availableCommands: [{ id: 'plan', name: 'plan', description: 'Create a plan.' }],
    toolCalls: [{ toolCallId: 'tc-1', title: 'Read file', status: 'completed', rawOutput: 'ok' }],
    toolSummary: { total: 1, pending: 0, inProgress: 0, completed: 1, failed: 0 },
    permissionEvents: [{
      requestId: 'perm-1',
      sessionId: 'agent-ses-declared',
      toolCallId: 'tc-2',
      toolName: 'Write file',
      status: 'resolved',
      options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
      selectedOptionId: 'allow',
      outcome: 'allow_once',
      requestedAt: CHECKED_AT,
      resolvedAt: '2026-06-26T00:01:01.000Z',
    }],
    pendingPermissions: [],
  };
}

describe('runtime session projections', () => {
  it('projects controls, commands, tools, and permissions from an active ACP session snapshot', () => {
    const payload = buildRuntimeSessionProjectionsPayload({
      runtimes: runtimes(),
      acpSessions: [acpSnapshot()],
    });

    const projection = payload.projections.find((item) => item.runtimeId === 'declared-acp');
    expect(projection).toMatchObject({
      status: 'idle',
      source: 'acp-session-snapshot',
      session: {
        kind: 'acp-session',
        sessionId: 'ses-declared',
        externalSessionId: 'agent-ses-declared',
        cwd: '/repo',
      },
      controls: {
        model: { status: 'available', source: 'session-observed', currentValue: 'smart' },
        mode: { status: 'available', source: 'session-observed', currentValue: 'code' },
        thoughtLevel: { status: 'available', source: 'session-observed', currentValue: 'high' },
      },
      slashCommands: { status: 'available', source: 'session-observed', commands: [{ id: 'plan', name: 'plan', description: 'Create a plan.' }] },
      toolEvents: { status: 'available', summary: { total: 1, completed: 1 } },
      permissionEvents: { status: 'available', pending: [] },
    });
  });

  it('falls back to adapter-declared model and command facts before an ACP session is active', () => {
    const payload = buildRuntimeSessionProjectionsPayload({ runtimes: runtimes(), acpSessions: [] });
    const projection = payload.projections.find((item) => item.runtimeId === 'declared-acp');

    expect(projection).toMatchObject({
      status: 'limited',
      source: 'runtime-descriptor',
      blockers: ['runtime-session-snapshot'],
      controls: {
        model: {
          status: 'available',
          source: 'adapter-declared',
          options: [{ id: 'fast', label: 'Fast' }],
        },
      },
      slashCommands: {
        status: 'available',
        source: 'adapter-declared',
        commands: [{ id: 'commit', name: 'commit', description: 'Prepare a commit.' }],
      },
    });
  });

  it('honors runtime and session filters in the HTTP handler', async () => {
    const response = await handleRuntimeSessionProjectionsGet(
      new URLSearchParams('runtime=declared-acp&sessionId=ses-declared'),
      {
        listRuntimes: () => runtimes(),
        getAcpSessionSnapshots: () => [acpSnapshot()],
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projections: [
        {
          runtimeId: 'declared-acp',
          session: { sessionId: 'ses-declared' },
        },
      ],
    });
  });
});
