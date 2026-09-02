import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerContextAsset } from '../../knowledge/context-assets/index.js';
import { handleContextAssetsGet } from './context-assets.js';

describe('context asset server handler', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-context-assets-handler-'));
    registerContextAsset(mindRoot, {
      kind: 'echo-playbook',
      status: 'active',
      title: 'Review gate',
      path: 'Echo/Playbooks/review-gate.md',
      contentHash: 'a'.repeat(64),
      source: { kind: 'echo-card', ref: 'echo-card:one' },
    }, new Date('2026-09-02T06:00:00.000Z'));
    registerContextAsset(mindRoot, {
      kind: 'knowledge',
      status: 'deprecated',
      title: 'Old note',
      path: 'Archive/old.md',
      contentHash: 'b'.repeat(64),
      source: { kind: 'file', ref: 'file:Archive/old.md' },
    }, new Date('2026-09-02T05:00:00.000Z'));
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('lists filtered assets through a no-store product response', async () => {
    const response = await handleContextAssetsGet(
      new URLSearchParams('kind=echo-playbook&status=active&limit=10'),
      { mindRoot },
    );

    expect(response).toMatchObject({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        schemaVersion: 1,
        assets: [expect.objectContaining({ title: 'Review gate', kind: 'echo-playbook' })],
        summary: { total: 1, active: 1 },
      },
    });
  });

  it('ignores invalid filters instead of widening them into unsafe input', async () => {
    const response = await handleContextAssetsGet(
      new URLSearchParams('kind=../../bad&status=unknown&limit=999999'),
      { mindRoot },
    );
    expect(response.status).toBe(200);
    expect((response.body as any).assets).toHaveLength(2);
  });
});
