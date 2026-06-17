import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/assistant-runs/route';
import { getTestMindRoot, seedFile } from '../setup';
import {
  listAgentEvents,
  listAgentRuns,
  resetAgentRunsForTest,
} from '@geminilight/mindos/agent/ledger/run-ledger';

describe('POST /api/assistant-runs', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('runs the Dreaming Assistant and records an agent ledger entry', async () => {
    seedFile('source.md', 'See [[missing-page]] in a note with enough body text to avoid being only a stub.');

    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'dreaming',
        trigger: 'manual',
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      assistantId: 'dreaming',
      trigger: 'manual',
      runtimeContextSnapshot: {
        assistantId: 'dreaming',
        trigger: 'manual',
        runner: 'dreaming',
        permissionMode: 'agent',
        outputPolicy: {
          mode: 'review',
          target: '.mindos/dreaming',
        },
        context: {
          space: 'all',
        },
        dryRun: false,
      },
    });
    expect(body.agentRunId).toEqual(expect.any(String));
    expect(body.run.proposals.length).toBeGreaterThan(0);
    expect(body.report).toContain('Dreaming Report');
    expect(fs.existsSync(path.join(getTestMindRoot(), '.mindos/dreaming/latest.json'))).toBe(true);
    expect(fs.existsSync(path.join(getTestMindRoot(), '.mindos/dreaming/pending.json'))).toBe(true);

    const runs = listAgentRuns({ kind: 'mindos-headless' });
    expect(runs).toEqual([
      expect.objectContaining({
        id: body.agentRunId,
        runtimeId: 'assistant:dreaming',
        displayName: 'Dreaming Assistant',
        status: 'completed',
        permissionMode: 'agent',
        metadata: expect.objectContaining({
          source: 'assistant-run',
          assistantId: 'dreaming',
          trigger: 'manual',
          dryRun: false,
          space: 'all',
          dreamingRunId: body.run.id,
          proposalCount: body.run.proposals.length,
        }),
      }),
    ]);
    expect(listAgentEvents({ runId: body.agentRunId, category: 'tool' }).map(event => event.type)).toEqual([
      'tool_completed',
      'tool_started',
    ]);
  });

  it('supports dry runs without writing Dreaming artifacts', async () => {
    seedFile('Projects/source.md', 'See [[missing-page]] in a note with enough body text to avoid being only a stub.');

    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({
        assistantId: 'dreaming',
        dryRun: true,
        context: {
          space: 'Projects',
        },
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.run.scope).toBe('Projects');
    expect(body.run.artifacts).toBeUndefined();
    expect(body.artifacts).toBeUndefined();
    expect(fs.existsSync(path.join(getTestMindRoot(), '.mindos/dreaming/latest.json'))).toBe(false);
    expect(listAgentRuns({ kind: 'mindos-headless' })[0]).toMatchObject({
      status: 'completed',
      metadata: expect.objectContaining({
        dryRun: true,
        space: 'Projects',
      }),
    });
  });

  it('rejects assistants without a dedicated runner', async () => {
    const response = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({ assistantId: 'daily-signal' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'UNSUPPORTED_ASSISTANT',
        message: 'Assistant "daily-signal" does not have a dedicated runner yet.',
      },
    });
    expect(listAgentRuns()).toEqual([]);
  });

  it('rejects unsafe assistant ids and spaces before starting a run', async () => {
    const unsafeAssistant = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({ assistantId: '../dreaming' }),
    }));
    expect(unsafeAssistant.status).toBe(400);
    expect(await unsafeAssistant.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ASSISTANT_ID' },
    });

    const unsafeSpace = await POST(new Request('http://localhost/api/assistant-runs', {
      method: 'POST',
      body: JSON.stringify({ assistantId: 'dreaming', context: { space: '../Notes' } }),
    }));
    expect(unsafeSpace.status).toBe(400);
    expect(await unsafeSpace.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SPACE' },
    });
    expect(listAgentRuns()).toEqual([]);
  });
});
