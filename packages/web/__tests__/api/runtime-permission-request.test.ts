import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/ask/runtime-permission/request/route';
import {
  resolveRuntimePermission,
  runWithRuntimePermissionBridge,
} from '@geminilight/mindos/agent/bridges/runtime-permission-bridge';

function postJson(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/ask/runtime-permission/request', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/ask/runtime-permission/request', () => {
  it('registers an external Claude Code permission request and returns the UI decision', async () => {
    const send = vi.fn();

    const result = await runWithRuntimePermissionBridge({ runId: 'run-api', send }, async () => {
      const responsePromise = POST(postJson({
        runId: 'run-api',
        runtime: 'claude',
        toolCallId: 'toolu-api',
        toolName: 'Bash',
        input: { command: 'mindos file delete "Profile.md"' },
        reason: 'Delete a note',
      }));

      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
          type: 'runtime_permission_request',
          runId: 'run-api',
          toolCallId: 'toolu-api',
          action: 'command',
          risk: expect.objectContaining({
            level: 'high',
            summary: 'Deletes or removes local files.',
          }),
        }));
      });
      const event = send.mock.calls.find(([item]) => item.type === 'runtime_permission_request')?.[0];
      expect(resolveRuntimePermission({
        runId: 'run-api',
        requestId: event.requestId,
        decision: 'accept',
      })).toEqual({ ok: true });

      const response = await responsePromise;
      return response.json();
    });

    expect(result).toMatchObject({
      decision: 'accept',
      cancelled: false,
      decisionLabel: 'Allow once',
      decisionIntent: 'allow',
    });
  });

  it('returns a cancelled decision when the run is not active', async () => {
    const response = await POST(postJson({
      runId: 'missing-run',
      runtime: 'claude',
      toolCallId: 'toolu-missing',
      toolName: 'Bash',
      input: {},
    }));

    await expect(response.json()).resolves.toEqual({ decision: 'cancel', cancelled: true });
  });

  it('rejects unknown runtime values instead of silently treating them as Claude', async () => {
    const response = await POST(postJson({
      runId: 'run-api',
      runtime: 'unknown',
      toolCallId: 'toolu-api',
      toolName: 'Bash',
      input: {},
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'runtime must be codex or claude.' });
  });
});
