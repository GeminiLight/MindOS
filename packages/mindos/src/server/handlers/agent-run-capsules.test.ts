import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentRunCapsule } from '../../agent/capsules/store.js';
import {
  handleAgentRunCapsuleRecoveryPost,
  handleAgentRunCapsulesGet,
} from './agent-run-capsules.js';

let mindRoot = '';

describe('agent run capsule handlers', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-capsule-handler-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
    createAgentRunCapsule(mindRoot, {
      id: 'capsule-1',
      runId: 'run-1',
      rootRunId: 'run-1',
      chatSessionId: 'chat-1',
      source: 'interactive',
      request: {
        messages: [{ role: 'user', content: 'Deploy with sk-private-token-value' }],
        runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
        runtimeBinding: {
          type: 'codex-thread', runtime: 'codex', runtimeId: 'codex',
          externalSessionId: 'thread-1', status: 'active',
        },
        context: { attachedFiles: [], uploadedFiles: [], receiptIds: [], assetIds: [] },
      },
      now: new Date('2026-09-03T10:00:00.000Z'),
    });
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('lists only public redacted projections and supports filtering by run', () => {
    const response = handleAgentRunCapsulesGet(new URLSearchParams('runId=run-1'), { mindRoot });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      capsules: [expect.objectContaining({
        id: 'capsule-1',
        inputSummary: 'Deploy with [REDACTED]',
      })],
    });
    expect(JSON.stringify(response.body)).not.toContain('sk-private-token-value');
  });

  it('creates an idempotent recovery plan and rejects invalid or unavailable actions', () => {
    const first = handleAgentRunCapsuleRecoveryPost('capsule-1', {
      action: 'resume', idempotencyKey: 'resume-1',
    }, { mindRoot, now: () => new Date('2026-09-03T10:01:00.000Z') });
    const repeated = handleAgentRunCapsuleRecoveryPost('capsule-1', {
      action: 'resume', idempotencyKey: 'resume-1',
    }, { mindRoot, now: () => new Date('2026-09-03T10:02:00.000Z') });

    expect(first.status).toBe(201);
    expect(repeated.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      schemaVersion: 1,
      plan: expect.objectContaining({
        sourceCapsuleId: 'capsule-1',
        action: 'resume',
        targetChatSessionId: 'chat-1',
        request: expect.objectContaining({
          runtimeBinding: expect.objectContaining({ externalSessionId: 'thread-1' }),
        }),
      }),
    });

    expect(handleAgentRunCapsuleRecoveryPost('capsule-1', { action: 'teleport' }, { mindRoot }).status).toBe(400);
    expect(handleAgentRunCapsuleRecoveryPost('missing', {
      action: 'retry', idempotencyKey: 'missing-1',
    }, { mindRoot }).status).toBe(404);
  });
});
