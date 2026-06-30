import { describe, expect, it } from 'vitest';
import { echoImprintExtractionTask } from '@/lib/ai/tasks/echo-imprint-extract';

describe('echo imprint extraction task', () => {
  const input = {
    window: {
      since: '2026-06-29T10:00:00.000Z',
      until: '2026-06-29T11:00:00.000Z',
    },
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
    ],
  };

  it('keeps only cards with valid source message refs', () => {
    const output = echoImprintExtractionTask.validateOutput({
      cards: [
        {
          title: 'Imprint extraction became a structured task',
          summary: 'The conversation established a tool-free AI task boundary.',
          source: {
            sessionIds: ['s-1'],
            messageRefs: [
              {
                sessionId: 's-1',
                messageIndex: 0,
                role: 'user',
                quote: 'Imprint 调 LM',
              },
            ],
          },
          whyItMatters: 'The user keeps control because LM output remains editable.',
          route: 'insight',
          confidence: 0.9,
          agencyTags: ['user_decision'],
        },
        {
          title: 'Invalid source should not pass',
          summary: 'This references a message that does not exist.',
          source: {
            sessionIds: ['s-1'],
            messageRefs: [
              {
                sessionId: 's-1',
                messageIndex: 99,
                role: 'user',
                quote: 'missing',
              },
            ],
          },
          whyItMatters: 'Invalid provenance is unsafe.',
          route: 'archive',
          confidence: 0.2,
          agencyTags: [],
        },
      ],
      rejected: [],
    }, input);

    expect(output.cards).toHaveLength(1);
    expect(output.cards[0]).toMatchObject({
      title: 'Imprint extraction became a structured task',
      source: {
        sessionIds: ['s-1'],
      },
    });
  });
});
