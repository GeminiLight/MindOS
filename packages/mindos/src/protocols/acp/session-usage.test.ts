import { describe, expect, it } from 'vitest';
import { sdkNotificationToUpdate } from './session-callbacks.js';

/**
 * ACP `usage_update` reports context consumption and cumulative session cost.
 * Neither the ACP lane nor the native Claude / Codex lanes surfaced it before,
 * so users had no spend signal for external agents
 * (spec-acp-first-agent-integration 现状分析).
 */

function usageUpdate(payload: Record<string, unknown>) {
  return { sessionId: 'session-1', update: { sessionUpdate: 'usage_update', ...payload } } as never;
}

describe('ACP usage parsing', () => {
  it('reads the tokens in context and the window they are measured against', () => {
    expect(sdkNotificationToUpdate('session-1', usageUpdate({ used: 12_000, size: 200_000 })).usage)
      .toEqual({ usedTokens: 12_000, contextWindow: 200_000 });
  });

  it('keeps the cumulative session cost with its currency', () => {
    expect(sdkNotificationToUpdate('session-1', usageUpdate({
      used: 5,
      size: 100,
      cost: { amount: 0.4213, currency: 'USD' },
    })).usage).toEqual({
      usedTokens: 5,
      contextWindow: 100,
      cost: { amount: 0.4213, currency: 'USD' },
    });
  });

  it('accepts a zero-cost session rather than hiding a free run', () => {
    expect(sdkNotificationToUpdate('session-1', usageUpdate({
      used: 1,
      size: 10,
      cost: { amount: 0, currency: 'USD' },
    })).usage?.cost).toEqual({ amount: 0, currency: 'USD' });
  });

  it('drops a cost without a usable amount or currency instead of showing a blank price', () => {
    for (const cost of [null, {}, { amount: 'free', currency: 'USD' }, { amount: 1 }, { amount: Number.NaN, currency: 'USD' }]) {
      expect(sdkNotificationToUpdate('session-1', usageUpdate({ used: 1, size: 10, cost })).usage?.cost)
        .toBeUndefined();
    }
  });

  it('ignores an update with no usable token counts', () => {
    for (const payload of [{}, { used: -1, size: 10 }, { used: 10, size: 0 }, { used: 'lots', size: 10 }]) {
      expect(sdkNotificationToUpdate('session-1', usageUpdate(payload)).usage).toBeUndefined();
    }
  });

  it('keeps very large counts intact, since agents report cumulative session totals', () => {
    expect(sdkNotificationToUpdate('session-1', usageUpdate({ used: 9_000_000, size: 10_000_000 })).usage)
      .toEqual({ usedTokens: 9_000_000, contextWindow: 10_000_000 });
  });

  it('allows usage above the window, which agents report right before compaction', () => {
    expect(sdkNotificationToUpdate('session-1', usageUpdate({ used: 210_000, size: 200_000 })).usage?.usedTokens)
      .toBe(210_000);
  });
});
