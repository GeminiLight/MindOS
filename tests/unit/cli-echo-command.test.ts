import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCardsUrl,
  formatAgreementLine,
  meta,
  resolveSegment,
  selectAgreements,
} from '../../packages/mindos/bin/commands/echo.js';

const ROOT = path.resolve(__dirname, '..', '..');

const AGREEMENT = {
  id: 'echo-card-1',
  kind: 'agreement',
  title: '以后都用 pnpm',
  content: '以后都用 pnpm，不要用 npm。',
  createdAt: '2026-11-09T06:00:00.000Z',
  source: {
    label: '你明确说过这是长期规则',
    sessions: [{ id: 's1', runtime: 'Codex', messageRefs: [{ messageIndex: 1, role: 'user', quote: '以后都用 pnpm。' }] }],
  },
};

const PLAYBOOK = { ...AGREEMENT, id: 'echo-card-2', kind: 'playbook', title: '先定义输入输出' };

describe('mindos echo', () => {
  describe('segment resolution', () => {
    it('defaults to the promotion segment, where agreements live', () => {
      expect(resolveSegment({})).toBe('promotion');
    });

    it('accepts the segments the API serves', () => {
      expect(resolveSegment({ segment: 'insight' })).toBe('insight');
      expect(resolveSegment({ segment: 'promotion' })).toBe('promotion');
    });

    it('rejects an unknown segment rather than silently querying another one', () => {
      expect(() => resolveSegment({ segment: 'imprint' })).toThrow(/segment/i);
      expect(() => resolveSegment({ segment: '../../etc/passwd' })).toThrow(/segment/i);
    });
  });

  describe('URL building', () => {
    it('encodes the segment into the cards endpoint', () => {
      expect(buildCardsUrl('http://localhost:4567', 'promotion'))
        .toBe('http://localhost:4567/api/echo/cards?segment=promotion');
    });

    it('does not let a crafted base URL escape the API path', () => {
      expect(buildCardsUrl('http://localhost:4567/', 'promotion'))
        .toBe('http://localhost:4567/api/echo/cards?segment=promotion');
    });
  });

  describe('selecting what to show', () => {
    it('shows only agreements by default', () => {
      expect(selectAgreements([AGREEMENT, PLAYBOOK], {}).map((card) => card.id)).toEqual(['echo-card-1']);
    });

    it('shows every promotion kind with --all', () => {
      expect(selectAgreements([AGREEMENT, PLAYBOOK], { all: true })).toHaveLength(2);
    });

    it('hides cards already reviewed unless asked for', () => {
      const reviewed = { ...AGREEMENT, id: 'echo-card-3', review: { status: 'approved' } };

      expect(selectAgreements([AGREEMENT, reviewed], {}).map((card) => card.id)).toEqual(['echo-card-1']);
      expect(selectAgreements([AGREEMENT, reviewed], { reviewed: true }).map((card) => card.id)).toEqual(['echo-card-1', 'echo-card-3']);
    });

    it('tolerates a malformed payload instead of throwing', () => {
      expect(selectAgreements(null, {})).toEqual([]);
      expect(selectAgreements([null, 7, {}], {})).toEqual([]);
    });
  });

  describe('output', () => {
    it('leads with the rule and attributes it to its source', () => {
      const line = formatAgreementLine(AGREEMENT);

      expect(line).toContain('以后都用 pnpm，不要用 npm。');
      expect(line).toContain('你明确说过这是长期规则');
      expect(line).toContain('echo-card-1');
    });

    it('marks a reviewed card with where it landed', () => {
      const line = formatAgreementLine({
        ...AGREEMENT,
        review: { status: 'approved', targetPath: '.mindos/user-preferences.md' },
      });

      expect(line).toContain('.mindos/user-preferences.md');
    });

    it('survives a card with no source label or content', () => {
      expect(() => formatAgreementLine({ id: 'x', kind: 'agreement', source: {} })).not.toThrow();
    });
  });

  describe('command contract', () => {
    it('declares itself for the CLI registry and help output', () => {
      expect(meta.name).toBe('echo');
      expect(meta.summary).toBeTruthy();
      expect(Object.keys(meta.flags ?? {})).toContain('--json');
      expect(meta.examples?.length ?? 0).toBeGreaterThan(0);
    });

    it('is registered so `mindos echo` resolves', async () => {
      const { MINDOS_CORE_COMMANDS, MINDOS_ADDITIONAL_COMMANDS } = await import('../../packages/mindos/src/cli.js');
      expect([...MINDOS_CORE_COMMANDS, ...MINDOS_ADDITIONAL_COMMANDS]).toContain('echo');
    });

    it('reaches the server over HTTP like the other knowledge commands', () => {
      const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'commands', 'echo.js'), 'utf-8');

      // A thin client, not a second copy of the generation logic.
      expect(source).toContain('getBaseUrl');
      expect(source).toContain('getAuthHeaders');
      expect(source).not.toContain('generateEchoCards');
    });
  });

  describe('approving from the terminal', () => {
    it('sends the approve action for the given card', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, review: { decision: 'approved', targetPath: '.mindos/user-preferences.md' } }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const { reviewCard } = await import('../../packages/mindos/bin/commands/echo.js');
      const review = await reviewCard('http://localhost:4567', {}, 'promotion', 'echo-card-1', 'approve');

      expect(review.decision).toBe('approved');
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toMatchObject({ segment: 'promotion', id: 'echo-card-1', action: 'approve' });

      vi.unstubAllGlobals();
    });

    it('surfaces the server error instead of reporting success', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Echo promotion card was already rejected.' }),
      })));

      const { reviewCard } = await import('../../packages/mindos/bin/commands/echo.js');
      await expect(reviewCard('http://localhost:4567', {}, 'promotion', 'echo-card-1', 'approve'))
        .rejects.toThrow(/already rejected/i);

      vi.unstubAllGlobals();
    });
  });
});
