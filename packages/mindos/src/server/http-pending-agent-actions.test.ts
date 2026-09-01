import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestRuntimePermissionForRun,
  runWithRuntimePermissionBridge,
} from '../agent/bridges/runtime-permission-bridge.js';
import {
  askUserQuestionViaBridge,
  runWithAskUserQuestionBridge,
} from '../agent/bridges/user-question-bridge.js';
import { createMindosHttpServer } from './http.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function startServer() {
  const root = mkdtempSync(join(tmpdir(), 'mindos-pending-actions-http-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const app = createMindosHttpServer({
    hostname: '127.0.0.1',
    port: 0,
    runtime: {
      homeDir: root,
      readSettings: () => ({ mindRoot: root, authToken: 'mobile-token' }),
    },
  });
  await app.listen();
  cleanups.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  return `http://127.0.0.1:${address.port}`;
}

const auth = { authorization: 'Bearer mobile-token' };

describe('Product Server pending agent action routes', () => {
  it('authenticates, lists, and resolves a runtime permission over HTTP', async () => {
    const base = await startServer();
    const result = runWithRuntimePermissionBridge({
      runId: 'http-permission-run',
      send: vi.fn(),
      timeoutMs: 30_000,
    }, async () => {
      const pending = requestRuntimePermissionForRun('http-permission-run', {
        runtime: 'codex',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        input: { command: 'pnpm test', apiKey: 'secret' },
        options: [
          { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
          { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
        ],
      }, { requestId: 'request-1' });

      expect((await fetch(`${base}/api/agent/pending-actions`)).status).toBe(401);
      const listed = await fetch(`${base}/api/agent/pending-actions`, { headers: auth });
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toMatchObject({
        pendingCount: 1,
        permissions: [expect.objectContaining({
          requestId: 'request-1',
          input: { command: 'pnpm test', apiKey: '[redacted]' },
        })],
      });

      const resolved = await fetch(`${base}/api/agent/runtime-permission`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'http-permission-run', requestId: 'request-1', decision: 'allow-once' }),
      });
      expect(resolved.status).toBe(200);
      return pending;
    });

    await expect(result).resolves.toMatchObject({ decision: 'allow-once', cancelled: false });
  });

  it('answers an AskUserQuestion over the authenticated HTTP bridge', async () => {
    const base = await startServer();
    const questionText = 'Ship this patch?';
    const result = runWithAskUserQuestionBridge({
      runId: 'http-question-run',
      send: vi.fn(),
      timeoutMs: 30_000,
    }, async () => {
      const pending = askUserQuestionViaBridge({
        toolCallId: 'question-1',
        params: {
          questions: [{
            header: 'Release',
            question: questionText,
            options: [{ label: 'Yes', description: 'Publish now.' }],
          }],
        },
      });
      const resolved = await fetch(`${base}/api/agent/user-question`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'http-question-run',
          toolCallId: 'question-1',
          answers: [{ questionIndex: 0, question: questionText, kind: 'option', answer: 'Yes' }],
        }),
      });
      expect(resolved.status).toBe(200);
      return pending;
    });

    await expect(result).resolves.toMatchObject({
      cancelled: false,
      answers: [expect.objectContaining({ answer: 'Yes' })],
    });
  });
});
