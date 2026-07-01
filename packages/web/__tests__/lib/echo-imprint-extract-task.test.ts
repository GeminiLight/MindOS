import { describe, expect, it } from 'vitest';
import { echoImprintExtractionTask } from '@/lib/ai/tasks/echo-imprint-extract';

describe('echo imprint extraction task', () => {
  const input = {
    segment: 'imprint' as const,
    allowedKinds: ['digest', 'moment'] as Array<'digest' | 'moment'>,
    window: {
      since: '2026-06-29T10:00:00.000Z',
      until: '2026-06-29T11:00:00.000Z',
    },
    locale: 'zh' as const,
    maxCards: 5,
    sessions: [
      {
        id: 's-1',
        title: 'Imprint discussion',
        createdAt: Date.parse('2026-06-29T10:05:00.000Z'),
        updatedAt: Date.parse('2026-06-29T10:45:00.000Z'),
        messages: [
          { role: 'user', content: '我们要让 Imprint 调 LM，但不能让它直接写 state。' },
          { role: 'assistant', content: '可以做一个 tool-free structured AiTaskRunner。' },
        ],
      },
      {
        id: 's-2',
        title: 'Runtime follow-up',
        runtime: 'Codex',
        createdAt: Date.parse('2026-06-29T10:15:00.000Z'),
        updatedAt: Date.parse('2026-06-29T10:50:00.000Z'),
        messages: [
          { role: 'user', content: '每个 session 可能有自己的 runtime。' },
          { role: 'assistant', content: 'source 应该保留 session 级 runtime，再嵌套 message refs。' },
        ],
      },
    ],
  };

  it('pins generated fields to the requested output language', () => {
    const messages = echoImprintExtractionTask.buildMessages(input);

    expect(messages[0]?.content).toContain('Target output language: Simplified Chinese.');
    expect(messages[0]?.content).toContain('Every generated natural-language field must be in Simplified Chinese.');
    expect(messages[1]?.content).toContain('"locale": "zh"');
    expect(messages[1]?.content).toContain('"outputLanguage": "Simplified Chinese"');
  });

  it('keeps only cards with valid source message refs', () => {
    const output = echoImprintExtractionTask.validateOutput({
      cards: [
        {
          kind: 'moment',
          title: 'Imprint extraction became a structured task',
          content: 'The conversation established a tool-free AI task boundary.',
          source: {
            sessions: [
              {
                sessionId: 's-1',
                messageRefs: [
                  {
                    messageIndex: 0,
                    role: 'user',
                    quote: 'Imprint 调 LM',
                  },
                ],
              },
              {
                sessionId: 's-2',
                messageRefs: [
                  {
                    messageIndex: 1,
                    role: 'assistant',
                    quote: 'session 级 runtime',
                  },
                ],
              },
            ],
          },
          confidence: 0.9,
          tags: ['user_decision'],
        },
        {
          kind: 'moment',
          title: 'Invalid source should not pass',
          content: 'This references a message that does not exist.',
          source: {
            sessions: [
              {
                sessionId: 's-1',
                messageRefs: [
                  {
                    messageIndex: 99,
                    role: 'user',
                    quote: 'missing',
                  },
                ],
              },
            ],
          },
          confidence: 0.2,
          tags: [],
        },
      ],
      rejected: [],
    }, input);

    expect(output.cards).toHaveLength(1);
    expect(output.cards[0]).toMatchObject({
      title: 'Imprint extraction became a structured task',
      source: {
        sessions: [
          expect.objectContaining({
            sessionId: 's-1',
            messageRefs: [
              expect.objectContaining({ messageIndex: 0, role: 'user' }),
            ],
          }),
          expect.objectContaining({
            sessionId: 's-2',
            messageRefs: [
              expect.objectContaining({ messageIndex: 1, role: 'assistant' }),
            ],
          }),
        ],
      },
    });
  });
});
