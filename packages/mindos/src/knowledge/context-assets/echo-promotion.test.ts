import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listContextAssets, registerContextAsset } from './registry.js';
import {
  readEchoPromotionReview,
  reviewEchoPromotionCandidate,
} from './echo-promotion.js';

describe('Echo reviewed experience promotion', () => {
  let mindRoot: string;
  const now = new Date('2026-09-02T07:00:00.000Z');
  const candidate = {
    id: 'echo-card-promote-1',
    kind: 'playbook' as const,
    title: 'Review before durable memory',
    content: 'Require a human review gate before a generated lesson changes future agent behavior.',
    source: {
      label: 'Architecture session · messages #2',
      sessions: [{
        id: 'session-architecture',
        title: 'Architecture session',
        runtime: 'Codex',
        messageRefs: [{
          messageIndex: 1,
          role: 'assistant',
          quote: 'Use a review gate before durable memory promotion.',
        }],
      }],
    },
  };

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-echo-promotion-'));
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('approves a grounded candidate into one idempotent Markdown context asset', () => {
    const approved = reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate,
    }, now);
    const repeated = reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate,
    }, new Date('2026-09-02T07:01:00.000Z'));

    expect(approved).toMatchObject({
      cardId: candidate.id,
      decision: 'approved',
      assetId: expect.stringMatching(/^asset-/),
      targetPath: expect.stringMatching(/^Echo\/Playbooks\/review-before-durable-memory-[a-f0-9]{8}\.md$/),
      reviewedAt: now.toISOString(),
    });
    expect(repeated).toEqual(approved);
    expect(() => reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate: { ...candidate, content: 'Changed content under a finalized candidate id.' },
    }, new Date('2026-09-02T07:02:00.000Z'))).toThrow(/changed|collision|immutable/i);
    const markdown = readFileSync(join(mindRoot, approved.targetPath!), 'utf-8');
    expect(markdown).toContain('type: echo.playbook');
    expect(markdown).toContain(`contextAssetId: ${approved.assetId}`);
    expect(markdown).toContain(`sourceCardId: ${candidate.id}`);
    expect(markdown).toContain('Use a review gate before durable memory promotion.');
    expect(markdown).toContain(candidate.content);
    expect(listContextAssets(mindRoot, { sourceRef: `echo-card:${candidate.id}` })).toEqual([
      expect.objectContaining({
        id: approved.assetId,
        kind: 'echo-playbook',
        status: 'active',
        version: 1,
        path: approved.targetPath,
      }),
    ]);
    expect(readEchoPromotionReview(mindRoot, candidate.id)).toEqual(approved);
  });

  it('records rejection without creating a durable asset or public Echo note', () => {
    const rejected = reviewEchoPromotionCandidate(mindRoot, {
      decision: 'reject',
      candidate: { ...candidate, id: 'echo-card-reject-1', kind: 'practice' },
      note: 'Too generic to affect future work.',
    }, now);

    expect(rejected).toMatchObject({
      cardId: 'echo-card-reject-1',
      decision: 'rejected',
      note: 'Too generic to affect future work.',
    });
    expect(rejected).not.toHaveProperty('assetId');
    expect(rejected).not.toHaveProperty('targetPath');
    expect(listContextAssets(mindRoot)).toEqual([]);
    expect(existsSync(join(mindRoot, 'Echo'))).toBe(false);
  });

  it('rejects ungrounded candidates and conflicting second decisions', () => {
    expect(() => reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate: {
        ...candidate,
        id: 'echo-card-no-evidence',
        source: { label: 'No evidence', sessions: [{ id: 'session-empty', messageRefs: [] }] },
      },
    }, now)).toThrow(/evidence|message ref/i);

    reviewEchoPromotionCandidate(mindRoot, { decision: 'reject', candidate }, now);
    expect(() => reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate,
    }, now)).toThrow(/already rejected/i);
  });

  it('does not overwrite a conflicting pre-existing context asset', () => {
    const sourceRef = `echo-card:${candidate.id}`;
    const existing = registerContextAsset(mindRoot, {
      kind: 'echo-playbook',
      status: 'active',
      title: 'Existing owner',
      path: 'Echo/Playbooks/existing.md',
      contentHash: 'd'.repeat(64),
      source: { kind: 'echo-card', ref: sourceRef },
    }, now);

    expect(() => reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate,
    }, now)).toThrow(/context asset|conflict/i);
    expect(listContextAssets(mindRoot, { sourceRef })).toEqual([existing]);
    expect(readEchoPromotionReview(mindRoot, candidate.id)).toBeNull();
  });

  it('refuses promotion writes through a symlinked Echo directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mindos-echo-promotion-outside-'));
    symlinkSync(outside, join(mindRoot, 'Echo'), 'dir');

    expect(() => reviewEchoPromotionCandidate(mindRoot, {
      decision: 'approve',
      candidate,
    }, now)).toThrow(/Access denied|symlink|escape/i);
    expect(listContextAssets(mindRoot)).toEqual([]);

    rmSync(outside, { recursive: true, force: true });
  });
});
