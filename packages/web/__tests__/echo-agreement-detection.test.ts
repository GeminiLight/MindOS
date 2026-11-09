import { describe, expect, it } from 'vitest';
import {
  detectEchoAgreements,
  type AgreementSourceSession,
} from '@/lib/echo-agreement-detection';

function session(
  id: string,
  userText: string | string[],
  extra: Partial<AgreementSourceSession> = {},
): AgreementSourceSession {
  const texts = Array.isArray(userText) ? userText : [userText];
  return {
    id,
    runtime: 'Claude Code',
    updatedAt: Number(id.replace(/\D/g, '') || 1),
    messages: [
      { role: 'assistant', content: 'Done.' },
      ...texts.map((content) => ({ role: 'user', content })),
    ],
    ...extra,
  };
}

/**
 * These cases come from dogfooding the first implementation against 90 days of
 * real Claude Code and Codex transcripts. That run produced zero true positives
 * and six false positives, which is what reshaped the rules encoded here.
 */
describe('detectEchoAgreements', () => {
  describe('directives — a rule stated on purpose counts once', () => {
    it('accepts a standing rule from a single session', () => {
      const [agreement, ...rest] = detectEchoAgreements([
        session('s1', '我觉得跑一次就行了。以后除非我专门指定，默认就跑一次吧，别跑三次。'),
      ]);

      expect(rest).toHaveLength(0);
      expect(agreement.trigger).toBe('directive');
      expect(agreement.occurrenceCount).toBe(1);
      expect(agreement.content).toContain('默认就跑一次');
    });

    it.each([
      ['以后都用中文回复我', '以后都'],
      ['下次记得先跑测试再提交', '下次记得'],
      ['记住，提交前必须截图', '记住，'],
      ['默认就走 pnpm，不要用 npm', '默认就'],
      ['一律用 TypeScript 严格模式', '一律'],
      ['统一改成 IBM Plex Sans', '统一改成'],
      ['From now on, reply in Chinese.', 'from now on'],
      ['Always run the tests before committing.', 'always'],
      ['Use pnpm by default in this repo.', 'by default'],
    ])('treats %j as a directive', (text) => {
      const found = detectEchoAgreements([session('only', text)]);
      expect(found).toHaveLength(1);
      expect(found[0].trigger).toBe('directive');
    });

    it('ranks directives above repeated corrections', () => {
      const found = detectEchoAgreements([
        session('c1', '不要使用 any 类型'),
        session('c2', '不要使用 any 类型'),
        session('d1', '以后都用 pnpm，不要用 npm'),
      ]);

      expect(found[0].trigger).toBe('directive');
      expect(found.some((a) => a.trigger === 'repetition')).toBe(true);
    });
  });

  describe('repeated corrections — the weaker signal still needs repetition', () => {
    it('accepts a correction repeated across two sessions', () => {
      const [agreement] = detectEchoAgreements([
        session('s1', '说了多少次，不要用 any 类型，把类型补上。'),
        session('s2', '这里又用 any 了，改掉。'),
      ]);

      expect(agreement.trigger).toBe('repetition');
      expect(agreement.sessionCount).toBe(2);
      expect(agreement.sessions.flatMap((s) => s.messageRefs)).toHaveLength(2);
    });

    it('rejects a correction confined to one session', () => {
      expect(detectEchoAgreements([
        session('only', ['不要使用 any 类型', '又用 any 了，不要使用 any 类型']),
      ])).toEqual([]);
    });
  });

  describe('precision — phrases that merely contain a negation are not corrections', () => {
    it.each([
      '要不要批量删掉那 47 个分支？',
      'Settings 插件管理界面要不要砍？',
      '你能不能把默认模式改成 yolo',
      '这个也不能说充分吧，就是覆盖面还不够',
      '也，也不能说过于相似不好',
      '我发现 codex 每次都要重新连接 重试5次的',
    ])('ignores %j', (text) => {
      expect(detectEchoAgreements([session('a', text), session('b', text)])).toEqual([]);
    });

    it('still catches a real correction that contains a similar phrase', () => {
      const found = detectEchoAgreements([
        session('a', '要不要加个开关我再想想，但别用 any 类型'),
        session('b', '别用 any 类型，先补上去'),
      ]);
      expect(found).toHaveLength(1);
    });
  });

  describe('noise — transcripts carry traffic no human typed', () => {
    it('drops sessions whose opening turn is a byte-identical template', () => {
      const batch = Array.from({ length: 8 }, (_, i) => session(
        `batch${i + 1}`,
        '你是金融query质量评审员。只输出严格JSON，不要输出其他文字。',
      ));
      expect(detectEchoAgreements(batch)).toEqual([]);
    });

    it('keeps a genuine repeat that happens fewer times than the template threshold', () => {
      const found = detectEchoAgreements([
        session('a', '别用 any 类型'),
        session('b', '别用 any 类型'),
      ]);
      expect(found).toHaveLength(1);
    });

    it.each([
      'A session-scoped Stop hook is now active with condition: "以后都用中文"',
      'Caveat: The messages below were generated while running a command. 以后都用中文',
      '[Request interrupted by user] 以后都用中文',
      'This session is being continued from a previous conversation. 以后都用中文',
      '# AGENTS.md instructions for /repo — 以后都用中文',
    ])('ignores harness-authored turn %#', (text) => {
      expect(detectEchoAgreements([session('a', text)])).toEqual([]);
    });

    it('ignores a long paste even when it contains directive wording', () => {
      const paste = `以后都用中文回复。${'详细背景说明。'.repeat(120)}`;
      expect(paste.length).toBeGreaterThan(600);
      expect(detectEchoAgreements([session('a', paste)])).toEqual([]);
    });
  });

  describe('output shape', () => {
    it('records runtime, session and message index for each quote', () => {
      const [agreement] = detectEchoAgreements([
        session('s1', '以后都用中文回复我', { runtime: 'Codex', title: 'mindos-dev' }),
      ]);
      const ref = agreement.sessions[0];

      expect(ref).toMatchObject({ id: 's1', runtime: 'Codex', title: 'mindos-dev' });
      expect(ref.messageRefs[0]).toMatchObject({ messageIndex: 1, role: 'user' });
    });

    it('strips the directive marker from the stored rule but keeps it in the quote', () => {
      const [agreement] = detectEchoAgreements([session('s1', '以后都用中文回复我')]);

      expect(agreement.content).toBe('用中文回复我');
      expect(agreement.sessions[0].messageRefs[0].quote).toContain('以后都');
    });

    it('caps the result set and orders by recency within a trigger', () => {
      const found = detectEchoAgreements([
        session('s1', '以后都用中文回复我'),
        session('s2', '以后都先跑测试'),
        session('s3', '以后都先截图'),
        session('s4', '以后都用 pnpm'),
      ]);

      expect(found).toHaveLength(3);
      expect(found.map((a) => a.latestAt)).toEqual([4, 3, 2]);
    });
  });

  describe('boundary and error paths', () => {
    it('returns nothing for an empty list', () => {
      expect(detectEchoAgreements([])).toEqual([]);
    });

    it('returns nothing when only the assistant speaks', () => {
      expect(detectEchoAgreements([
        { id: 'a', updatedAt: 1, messages: [{ role: 'assistant', content: '以后都用中文' }] },
      ])).toEqual([]);
    });

    it('returns nothing for blank content', () => {
      expect(detectEchoAgreements([session('a', ['', '   \n\t '])])).toEqual([]);
    });

    it('truncates an over-long quote without throwing on emoji or CJK', () => {
      const text = `以后都不要使用 any 类型 🙏 ${'很'.repeat(200)}`;
      const [agreement] = detectEchoAgreements([session('a', text)]);

      expect(agreement.sessions[0].messageRefs[0].quote.length).toBeLessThanOrEqual(240);
      expect(agreement.content.length).toBeLessThanOrEqual(240);
    });

    it('honours maxAgreements of zero and falls back on invalid values', () => {
      const one = [session('a', '以后都用中文回复我')];
      expect(detectEchoAgreements(one, { maxAgreements: 0 })).toEqual([]);
      expect(detectEchoAgreements(one, { maxAgreements: -5 })).toHaveLength(1);
      expect(detectEchoAgreements(one, { maxAgreements: Number.NaN })).toHaveLength(1);
    });

    it('deduplicates sessions that share an id', () => {
      const found = detectEchoAgreements([
        session('same', '别用 any 类型'),
        session('same', '别用 any 类型'),
      ]);
      expect(found).toEqual([]);
    });

    it('ignores malformed input instead of throwing', () => {
      const malformed = [
        null, undefined, 42, 'session', {},
        { id: 'no-messages' },
        { id: 'bad-messages', messages: 'nope' },
        { id: 'bad-entries', messages: [null, 7, { role: 'user' }, { content: 'x' }] },
        { id: '', messages: [{ role: 'user', content: '以后都用中文' }] },
      ] as unknown as AgreementSourceSession[];

      expect(() => detectEchoAgreements(malformed)).not.toThrow();
      expect(detectEchoAgreements(malformed)).toEqual([]);
      expect(detectEchoAgreements(null as unknown as AgreementSourceSession[])).toEqual([]);
    });
  });
});
