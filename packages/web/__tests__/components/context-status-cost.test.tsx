// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextUsageMetadata } from '@/lib/agent/stream-consumer';
import ContextStatusButton from '@/components/ask/ContextStatusButton';
import { messages } from '@/lib/i18n';

/**
 * ACP agents report cumulative session cost through `usage_update`. Users had no
 * spend signal for external agents before
 * (spec-acp-first-agent-integration Phase 1b).
 */

const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: locale.value, t: messages.en }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function usageOf(overrides: Partial<ContextUsageMetadata> = {}): ContextUsageMetadata {
  return {
    runtime: 'acp',
    phase: 'post',
    action: 'none',
    percent: 25,
    usedTokens: 50_000,
    contextWindow: 200_000,
    budgetTokens: 200_000,
    reserveTokens: 0,
    systemPromptTokens: 0,
    turnPromptTokens: 0,
    historyTokens: 50_000,
    ...overrides,
  };
}

function openPopover(usage: ContextUsageMetadata): string {
  act(() => root.render(<ContextStatusButton usage={usage} />));
  act(() => { host.querySelector('button')!.click(); });
  return `${host.textContent ?? ''} ${document.body.textContent ?? ''}`;
}

beforeEach(() => {
  locale.value = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('context meter session cost', () => {
  it('shows the cumulative spend an agent reported', () => {
    expect(openPopover(usageOf({ cost: { amount: 1.25, currency: 'USD' } }))).toContain('1.25');
  });

  it('keeps sub-cent precision instead of rounding a cheap run to zero', () => {
    expect(openPopover(usageOf({ cost: { amount: 0.0042, currency: 'USD' } }))).toContain('0.0042');
  });

  it('reports an explicit zero cost rather than hiding it', () => {
    expect(openPopover(usageOf({ cost: { amount: 0, currency: 'USD' } }))).toMatch(/0(\.00)?\s*USD|USD\s*0/);
  });

  it('shows the agent-reported currency, not an assumed dollar sign', () => {
    expect(openPopover(usageOf({ cost: { amount: 3, currency: 'EUR' } }))).toContain('EUR');
  });

  it('says nothing about cost when the runtime does not report it', () => {
    const text = openPopover(usageOf());
    expect(text).not.toMatch(/USD|Session cost|本次会话花费/);
  });

  it('localizes the cost line for Chinese users', () => {
    locale.value = 'zh';
    expect(openPopover(usageOf({ cost: { amount: 2, currency: 'USD' } }))).toContain('花费');
  });
});
