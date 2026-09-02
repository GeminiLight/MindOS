import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerContextFileAsset } from '../knowledge/context-assets/index.js';
import { writeRetrievalReceipt } from '../retrieval/receipt.js';
import { resetAgentRunsForTest, startAgentRun } from '../agent/ledger/run-ledger.js';
import { createMindosHttpServer } from './http.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  resetAgentRunsForTest();
  while (cleanups.length) await cleanups.pop()?.();
});

async function startServer() {
  const root = mkdtempSync(join(tmpdir(), 'mindos-context-automation-http-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const app = createMindosHttpServer({
    hostname: '127.0.0.1',
    port: 0,
    runtime: {
      homeDir: root,
      readSettings: () => ({ mindRoot: root, authToken: 'context-token' }),
    },
  });
  await app.listen();
  cleanups.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  return { root, base: `http://127.0.0.1:${address.port}` };
}

const auth = { authorization: 'Bearer context-token' };

describe('Product Server context and durable automation routes', () => {
  it('serves context assets and retrieval receipts through authenticated routes', async () => {
    const { root, base } = await startServer();
    mkdirSync(join(root, 'Notes'), { recursive: true });
    writeFileSync(join(root, 'Notes', 'source.md'), '# Source\n');
    const asset = registerContextFileAsset(root, {
      path: 'Notes/source.md',
      kind: 'knowledge',
      source: { kind: 'file', ref: 'file:Notes/source.md' },
    });
    const receipt = writeRetrievalReceipt(root, {
      id: 'receipt-http-1',
      query: 'source',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'selected',
      startedAt: '2026-09-02T08:00:00.000Z',
      completedAt: '2026-09-02T08:00:00.001Z',
      budget: { maxTokens: 100, maxFiles: 1, minScore: 1, timeoutMs: 2_000 },
      scope: { preferredPaths: [], excludePaths: [] },
      candidates: [{ path: asset.path, assetId: asset.id, score: 5, selected: true, reason: 'selected' }],
      selections: [{
        path: asset.path,
        assetId: asset.id,
        score: 5,
        estimatedTokens: 3,
        truncated: false,
        reason: 'selected',
      }],
      totals: { candidateCount: 1, selectedCount: 1, usedTokens: 3 },
    });

    expect((await fetch(`${base}/api/context-assets`)).status).toBe(401);
    await expect((await fetch(`${base}/api/context-assets?kind=knowledge`, { headers: auth })).json())
      .resolves.toMatchObject({ assets: [expect.objectContaining({ id: asset.id })] });
    await expect((await fetch(`${base}/api/retrieval-receipts?id=${receipt.id}`, { headers: auth })).json())
      .resolves.toMatchObject({ receipt: { id: receipt.id } });
  });

  it('owns durable automation CRUD over the Product Server HTTP boundary', async () => {
    const { base } = await startServer();
    const created = await fetch(`${base}/api/studio/automations`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        draft: {
          title: 'HTTP radar',
          prompt: 'Build a daily radar.',
          scope: 'mind',
          schedule: 'manual',
          model: 'mindos-auto',
          effort: 'high',
        },
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      automations: [expect.objectContaining({ title: 'HTTP radar', source: 'mindos-durable' })],
    });

    const listed = await fetch(`${base}/api/studio/automations`, { headers: auth });
    await expect(listed.json()).resolves.toMatchObject({
      automations: [expect.objectContaining({ title: 'HTTP radar', nextRun: 'Manual' })],
    });
  });

  it('serves the run observatory through the authenticated Product Server boundary', async () => {
    const { base } = await startServer();
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'Inspect the release.',
    });

    expect((await fetch(`${base}/api/agent-runs?includeEvents=1`)).status).toBe(401);
    const response = await fetch(`${base}/api/agent-runs?includeEvents=1`, { headers: auth });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runs: [expect.objectContaining({ id: run.id })],
      observatory: {
        schemaVersion: 1,
        traces: [expect.objectContaining({ id: run.id, source: 'agent', runtimeIds: ['codex'] })],
      },
    });
  });
});
