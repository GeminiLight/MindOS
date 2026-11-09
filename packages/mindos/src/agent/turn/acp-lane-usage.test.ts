import { describe, expect, it } from 'vitest';
import { mapMindosAcpUpdateToSseEvents } from './acp-lane.js';

/**
 * External agents never reported spend or context pressure in MindOS. ACP
 * `usage_update` feeds the existing context meter instead of a new surface
 * (spec-acp-first-agent-integration 数据流 / usage).
 */

function usageEvent(update: Parameters<typeof mapMindosAcpUpdateToSseEvents>[0]) {
  return mapMindosAcpUpdateToSseEvents(update).events.find((event) => event.type === 'context_usage');
}

describe('ACP lane usage mapping', () => {
  it('reports context consumption against the agent-declared window', () => {
    expect(usageEvent({ type: 'usage_update', usage: { usedTokens: 50_000, contextWindow: 200_000 } }))
      .toMatchObject({
        type: 'context_usage',
        runtime: 'acp',
        phase: 'post',
        action: 'none',
        percent: 25,
        usedTokens: 50_000,
        contextWindow: 200_000,
      });
  });

  it('passes the session cost through so the meter can show spend', () => {
    expect(usageEvent({
      type: 'usage_update',
      usage: { usedTokens: 10, contextWindow: 100, cost: { amount: 1.25, currency: 'USD' } },
    })).toMatchObject({ cost: { amount: 1.25, currency: 'USD' } });
  });

  it('caps the headline percentage when an agent reports past its window', () => {
    expect(usageEvent({ type: 'usage_update', usage: { usedTokens: 300_000, contextWindow: 200_000 } }))
      .toMatchObject({ percent: 100, usedTokens: 300_000 });
  });

  it('reports a fresh session as zero rather than omitting the meter', () => {
    expect(usageEvent({ type: 'usage_update', usage: { usedTokens: 0, contextWindow: 200_000 } }))
      .toMatchObject({ percent: 0, usedTokens: 0 });
  });

  it('stays silent when the agent sent no usable usage', () => {
    expect(usageEvent({ type: 'usage_update' })).toBeUndefined();
  });

  it('does not count as visible content, so a usage ping cannot mask an error', () => {
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'usage_update',
      usage: { usedTokens: 1, contextWindow: 10 },
    }).hasVisibleContent).toBe(false);
  });
});
