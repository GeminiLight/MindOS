import { describe, expect, it } from 'vitest';
import {
  prepareMindosPiContextBudget,
  resolveMindosPiContextWindow,
  resolveMindosPiContextWindowInfo,
  resolveMindosPiReserveTokens,
} from './context-budget.js';
import type { MindosAgentHistoryMessage } from '../turn/index.js';

const estimateTokens = (value: string) => Math.ceil(value.length / 10);

function user(content: string): MindosAgentHistoryMessage {
  return { role: 'user', content, timestamp: 1 };
}

function assistant(content: string): MindosAgentHistoryMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    stopReason: 'stop',
    timestamp: 1,
  };
}

describe('MindOS Pi context budget preflight', () => {
  it('uses the model context window when available and falls back conservatively', () => {
    expect(resolveMindosPiContextWindow({ contextWindow: 32_000 })).toBe(32_000);
    expect(resolveMindosPiContextWindow({ contextWindow: 0 })).toBe(128_000);
    expect(resolveMindosPiContextWindow(null)).toBe(128_000);
    expect(resolveMindosPiReserveTokens(128_000)).toBe(16_384);
    expect(resolveMindosPiReserveTokens(8_000)).toBe(1_600);
    expect(resolveMindosPiReserveTokens(8_000, 16_000)).toBe(7_999);
  });

  it('uses source-tracked MindOS model caps before the raw runtime model window', () => {
    expect(resolveMindosPiContextWindowInfo({
      contextWindow: 128_000,
      mindosCaps: {
        contextWindow: 256_000,
        contextTokens: 96_000,
        effectiveContextWindow: 96_000,
        source: 'catalog',
        isFallback: false,
      },
    })).toEqual({
      contextWindow: 96_000,
      nativeContextWindow: 256_000,
      contextTokens: 96_000,
      source: 'catalog',
      isFallback: false,
    });

    expect(resolveMindosPiContextWindowInfo({
      mindosCaps: {
        effectiveContextWindow: 128_000,
        source: 'fallback',
        isFallback: true,
      },
    })).toEqual({
      contextWindow: 128_000,
      source: 'fallback',
      isFallback: true,
    });
  });

  it('reports context usage without changing an under-budget prompt', () => {
    const history = [user('hello'), assistant('hi')];
    const result = prepareMindosPiContextBudget({
      systemPrompt: 'system',
      turnPrompt: 'current request',
      historyMessages: history,
      model: { contextWindow: 10_000 },
      modelName: 'test-model',
      reserveTokens: 100,
      keepRecentTokens: 50,
      estimateTokens,
    });

    expect(result.turnPrompt).toBe('current request');
    expect(result.historyMessages).toBe(history);
    expect(result.usage).toMatchObject({
      type: 'context_usage',
      runtime: 'mindos',
      phase: 'preflight',
      action: 'none',
      modelName: 'test-model',
      contextWindow: 10_000,
      budgetTokens: 9_900,
      reserveTokens: 100,
      nativeContextWindow: 10_000,
      contextWindowSource: 'model',
      contextWindowIsFallback: false,
    });
    expect(result.usage.percent).toBeGreaterThan(0);
  });

  it('emits context window source metadata in the preflight usage event', () => {
    const result = prepareMindosPiContextBudget({
      systemPrompt: 'system',
      turnPrompt: 'current request',
      historyMessages: [],
      model: {
        contextWindow: 128_000,
        mindosCaps: {
          contextWindow: 256_000,
          contextTokens: 64_000,
          effectiveContextWindow: 64_000,
          source: 'user',
          isFallback: false,
        },
      },
      modelName: 'capped-model',
      reserveTokens: 4_000,
      keepRecentTokens: 50,
      estimateTokens,
    });

    expect(result.usage).toMatchObject({
      contextWindow: 64_000,
      nativeContextWindow: 256_000,
      contextTokens: 64_000,
      contextWindowSource: 'user',
      contextWindowIsFallback: false,
      budgetTokens: 60_000,
    });
  });

  it('prunes oldest history on a user boundary and prefixes a transparent note', () => {
    const long = 'x'.repeat(1_000);
    const history = [
      user(`oldest ${long}`),
      assistant(long),
      user(`middle ${long}`),
      assistant(long),
      user(`recent ${long}`),
      assistant('short answer'),
    ];

    const result = prepareMindosPiContextBudget({
      systemPrompt: 'system prompt',
      turnPrompt: 'current prompt',
      historyMessages: history,
      model: { contextWindow: 360 },
      modelName: 'small-window',
      reserveTokens: 100,
      keepRecentTokens: 50,
      estimateTokens,
    });

    expect(result.historyMessages.length).toBeLessThan(history.length);
    expect(result.historyMessages[0]).toMatchObject({ role: 'user' });
    expect(String(result.historyMessages[0]?.content)).toContain('older chat history was pruned');
    expect(result.usage.action).toBe('history_pruned');
    expect(result.usage.prunedMessages).toBeGreaterThan(0);
    expect(result.usage.usedTokens).toBeLessThanOrEqual(result.usage.budgetTokens);
  });

  it('compacts then truncates an oversized turn prompt before history is appended', () => {
    const latestRequest = 'LATEST USER REQUEST: answer the provider/model capability question';
    const hugePrompt = [
      latestRequest,
      '## MindOS Turn Context',
      `## Auto-Recalled MindOS Knowledge\n\n${'r'.repeat(5_000)}`,
      `## Files uploaded by the user for this request\n\n${'u'.repeat(5_000)}`,
    ].join('\n\n---\n\n');
    const strippedSections: string[] = [];

    const result = prepareMindosPiContextBudget({
      systemPrompt: 'system prompt',
      turnPrompt: hugePrompt,
      historyMessages: [user('old context')],
      model: { contextWindow: 420 },
      modelName: 'tiny-window',
      reserveTokens: 100,
      keepRecentTokens: 50,
      estimateTokens,
      compactPrompt: (prompt, options) => {
        const sections = prompt.split('\n\n---\n\n');
        const kept: string[] = [];
        let total = 0;
        for (const section of sections) {
          const tokens = options.estimateTokens(section);
          if (total + tokens <= options.maxPromptTokens) {
            kept.push(section);
            total += tokens;
          } else {
            strippedSections.push(section.slice(0, 20));
          }
        }
        return kept.join('\n\n---\n\n');
      },
    });

    expect(strippedSections.length).toBeGreaterThan(0);
    expect(result.turnPrompt).toContain(latestRequest);
    expect(result.turnPrompt.length).toBeLessThan(hugePrompt.length);
    expect(result.usage.action).toMatch(/prompt_(compacted|truncated)/);
    expect(result.usage.usedTokens).toBeLessThan(result.usage.originalUsedTokens ?? 0);
    expect(result.usage.usedTokens).toBeLessThanOrEqual(result.usage.budgetTokens);
  });

  it('hard-truncates an oversized turn prompt to fit the remaining budget', () => {
    const result = prepareMindosPiContextBudget({
      systemPrompt: 'system prompt',
      turnPrompt: 'current request '.repeat(1_000),
      historyMessages: [],
      model: { contextWindow: 260 },
      modelName: 'small-window',
      reserveTokens: 80,
      keepRecentTokens: 50,
      estimateTokens,
    });

    expect(result.usage.action).toBe('prompt_truncated');
    expect(result.turnPrompt).toContain('middle content omitted');
    expect(result.usage.usedTokens).toBeLessThanOrEqual(result.usage.budgetTokens);
  });
});
