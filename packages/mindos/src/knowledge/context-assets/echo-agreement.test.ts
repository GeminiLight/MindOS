import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listContextAssets } from './registry.js';
import { normalizeEchoPromotionKind, reviewEchoPromotionCandidate } from './echo-promotion.js';

const PREFERENCES_PATH = '.mindos/user-preferences.md';

describe('Echo agreement promotion into agent startup preferences', () => {
  let mindRoot: string;
  const now = new Date('2026-11-09T08:00:00.000Z');

  const agreement = {
    id: 'echo-card-agreement-1',
    kind: 'agreement' as const,
    title: '不要使用 any 类型',
    content: '写 TypeScript 时不要使用 any 类型，拿不到类型时先用 unknown 再收窄。',
    source: {
      label: '3 次对话',
      sessions: [{
        id: 'session-march-15',
        title: 'mindos-dev',
        runtime: 'Claude Code',
        messageRefs: [{
          messageIndex: 1,
          role: 'user',
          quote: '说了多少次，不要用 any 类型，把 payload 的类型补上。',
        }],
      }, {
        id: 'session-march-2',
        title: 'landing',
        runtime: 'Claude Code',
        messageRefs: [{
          messageIndex: 1,
          role: 'user',
          quote: '可以，不过别用 any 类型，其他没问题。',
        }],
      }],
    },
  };

  const readPreferences = () => readFileSync(join(mindRoot, PREFERENCES_PATH), 'utf-8');

  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-echo-agreement-'));
  });

  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  describe('normal path', () => {
    it('creates the preferences file from the template and appends the rule', () => {
      const review = reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);
      const content = readPreferences();

      expect(review.decision).toBe('approved');
      expect(review.targetPath).toBe(PREFERENCES_PATH);
      expect(content).toContain('# User Skill Rules');
      expect(content).toContain('## Preferences');
      expect(content).toContain(agreement.content);
      expect(content).toContain(`<!-- echo-card:${agreement.id} -->`);
      expect(content).toContain('2026-11-09');
    });

    it('registers a context asset pointing at the preferences file', () => {
      const review = reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);
      const assets = listContextAssets(mindRoot, { sourceRef: `echo-card:${agreement.id}` });

      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        id: review.assetId,
        kind: 'echo-agreement',
        path: PREFERENCES_PATH,
      });
    });

    it('appends a second agreement without disturbing the first', () => {
      const second = { ...agreement, id: 'echo-card-agreement-2', content: '回复我时用中文，代码注释保持英文。' };

      reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);
      reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: second }, now);
      const content = readPreferences();

      expect(content).toContain(agreement.content);
      expect(content).toContain(second.content);
      expect(content.match(/<!-- echo-card:/g)).toHaveLength(2);
      expect(content.match(/^### Echo agreements$/gm)).toHaveLength(1);
    });

    it('preserves hand-written preferences already in the file', () => {
      mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
      writeFileSync(join(mindRoot, PREFERENCES_PATH), [
        '# User Skill Rules',
        '<!-- auto-confirm-all: false -->',
        '',
        '## Preferences',
        '',
        '### Writing',
        '<!-- auto-confirm: false -->',
        '- Keep commit messages in English — _2026-10-01_',
        '',
        '## Suppressed Hooks',
        '',
      ].join('\n'), 'utf-8');

      reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);
      const content = readPreferences();

      expect(content).toContain('- Keep commit messages in English — _2026-10-01_');
      expect(content).toContain('### Writing');
      expect(content).toContain('## Suppressed Hooks');
      expect(content).toContain(agreement.content);
    });
  });

  describe('idempotency and rejection', () => {
    it('returns the existing review and leaves the file untouched when approved twice', () => {
      const first = reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);
      const before = readPreferences();

      const repeated = reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);

      expect(repeated).toEqual(first);
      expect(readPreferences()).toBe(before);
    });

    it('does not touch the preferences file when the agreement is rejected', () => {
      const review = reviewEchoPromotionCandidate(mindRoot, { decision: 'reject', candidate: agreement }, now);

      expect(review.decision).toBe('rejected');
      expect(review.targetPath).toBeUndefined();
      expect(existsSync(join(mindRoot, PREFERENCES_PATH))).toBe(false);
    });

    it('refuses to flip a rejected agreement into an approval', () => {
      reviewEchoPromotionCandidate(mindRoot, { decision: 'reject', candidate: agreement }, now);

      expect(() => reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now))
        .toThrow(/already rejected/i);
      expect(existsSync(join(mindRoot, PREFERENCES_PATH))).toBe(false);
    });
  });

  describe('boundary cases', () => {
    it('rebuilds missing structure instead of overwriting an unexpected file shape', () => {
      mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
      writeFileSync(join(mindRoot, PREFERENCES_PATH), 'just some notes the user typed\n', 'utf-8');

      reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);
      const content = readPreferences();

      expect(content).toContain('just some notes the user typed');
      expect(content).toContain('## Preferences');
      expect(content).toContain(agreement.content);
    });

    it('keeps an empty preferences file usable', () => {
      mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
      writeFileSync(join(mindRoot, PREFERENCES_PATH), '', 'utf-8');

      reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: agreement }, now);

      expect(readPreferences()).toContain(agreement.content);
    });

    it('flattens multi-line rule content into a single bullet', () => {
      const multiline = { ...agreement, id: 'echo-card-agreement-multiline', content: 'line one\nline two\n\nline three' };

      reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: multiline }, now);
      const bullet = readPreferences().split('\n').find((line) => line.includes('echo-card-agreement-multiline'));

      expect(bullet).toContain('line one line two line three');
    });
  });

  describe('error paths', () => {
    it('refuses to approve an agreement with no grounded evidence', () => {
      const ungrounded = {
        ...agreement,
        id: 'echo-card-agreement-ungrounded',
        source: { sessions: [{ id: 'session-x', messageRefs: [] }] },
      };

      expect(() => reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: ungrounded }, now))
        .toThrow(/evidence/i);
      expect(existsSync(join(mindRoot, PREFERENCES_PATH))).toBe(false);
    });

    it('rejects an unknown kind instead of filing it under a default', () => {
      const bogus = { ...agreement, kind: 'manifesto' } as unknown as typeof agreement;

      expect(() => reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: bogus }, now))
        .toThrow(/must be one of/i);
    });

    it('rejects a kind the caller did not allow', () => {
      expect(() => normalizeEchoPromotionKind('agreement', ['playbook', 'practice'])).toThrow(/must be one of/i);
      expect(normalizeEchoPromotionKind('playbook', ['playbook', 'practice'])).toBe('playbook');
      expect(normalizeEchoPromotionKind('agreement')).toBe('agreement');
    });

    it('rejects an unknown candidate kind', () => {
      const bogus = { ...agreement, kind: 'manifesto' } as unknown as typeof agreement;

      expect(() => reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: bogus }, now))
        .toThrow(/kind must be/i);
    });
  });

  describe('regression: existing promotion kinds are unchanged', () => {
    it('still files a playbook under Echo/Playbooks as its own Markdown note', () => {
      const playbook = { ...agreement, id: 'echo-card-playbook-1', kind: 'playbook' as const };

      const review = reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: playbook }, now);

      expect(review.targetPath).toMatch(/^Echo\/Playbooks\/.+\.md$/);
      expect(existsSync(join(mindRoot, PREFERENCES_PATH))).toBe(false);
      expect(readFileSync(join(mindRoot, review.targetPath!), 'utf-8')).toContain('## Evidence');
    });

    it('still files a practice under Echo/Practices', () => {
      const practice = { ...agreement, id: 'echo-card-practice-1', kind: 'practice' as const };

      const review = reviewEchoPromotionCandidate(mindRoot, { decision: 'approve', candidate: practice }, now);

      expect(review.targetPath).toMatch(/^Echo\/Practices\/.+\.md$/);
      expect(existsSync(join(mindRoot, PREFERENCES_PATH))).toBe(false);
    });
  });
});
