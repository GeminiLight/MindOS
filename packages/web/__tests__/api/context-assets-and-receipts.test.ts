import { describe, expect, it } from 'vitest';
import { registerContextFileAsset } from '@geminilight/mindos/knowledge';
import { writeRetrievalReceipt } from '@geminilight/mindos/retrieval';
import { seedFile, testMindRoot } from '../setup';
import { GET as getContextAssets } from '../../app/api/context-assets/route';
import { GET as getRetrievalReceipts } from '../../app/api/retrieval-receipts/route';

describe('context provenance Web adapters', () => {
  it('lists registered context assets with server-side filters', async () => {
    seedFile('Echo/Playbooks/reviewed.md', '# Reviewed playbook\n');
    const asset = registerContextFileAsset(testMindRoot, {
      kind: 'echo-playbook',
      title: 'Reviewed playbook',
      path: 'Echo/Playbooks/reviewed.md',
      source: { kind: 'echo-card', ref: 'echo-card:reviewed' },
    });

    const response = await getContextAssets(new Request(
      'http://localhost/api/context-assets?kind=echo-playbook&status=active&limit=1',
    ));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      assets: [expect.objectContaining({
        id: asset.id,
        source: expect.objectContaining({ ref: 'echo-card:reviewed' }),
      })],
      summary: { total: 1, active: 1 },
    });
  });

  it('lists and retrieves immutable receipts without exposing raw query content', async () => {
    const receipt = writeRetrievalReceipt(testMindRoot, {
      id: 'receipt-web-adapter',
      query: 'find reviewed playbook with Authorization: Bearer secret-token',
      strategy: 'hybrid-heading-rerank-v1',
      outcome: 'selected',
      startedAt: '2026-09-02T03:00:00.000Z',
      completedAt: '2026-09-02T03:00:00.010Z',
      budget: { maxTokens: 800, maxFiles: 2, minScore: 1, timeoutMs: 2_000 },
      scope: { preferredPaths: ['Echo/Playbooks'], excludePaths: [] },
      candidates: [{
        assetId: 'asset-reviewed',
        path: 'Echo/Playbooks/reviewed.md',
        score: 8,
        selected: true,
        reason: 'highest score',
      }],
      selections: [{
        assetId: 'asset-reviewed',
        path: 'Echo/Playbooks/reviewed.md',
        score: 8,
        estimatedTokens: 12,
        truncated: false,
        reason: 'highest score',
      }],
      totals: { candidateCount: 1, selectedCount: 1, usedTokens: 12 },
      metadata: { chatSessionId: 'chat-web-adapter' },
    });

    const listed = await getRetrievalReceipts(new Request(
      'http://localhost/api/retrieval-receipts?outcome=selected&assetId=asset-reviewed',
    ));
    const listedBody = await listed.json();
    expect(listed.status, JSON.stringify(listedBody)).toBe(200);
    expect(listedBody).toMatchObject({
      receipts: [expect.objectContaining({ id: receipt.id, queryHash: expect.any(String) })],
      summary: { total: 1, selected: 1 },
    });
    expect(JSON.stringify(listedBody)).not.toContain('secret-token');

    const single = await getRetrievalReceipts(new Request(
      `http://localhost/api/retrieval-receipts?id=${receipt.id}`,
    ));
    await expect(single.json()).resolves.toMatchObject({ receipt: { id: receipt.id } });

    const missing = await getRetrievalReceipts(new Request(
      'http://localhost/api/retrieval-receipts?id=receipt-missing',
    ));
    expect(missing.status).toBe(404);
  });
});
