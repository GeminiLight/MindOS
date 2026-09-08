// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ContextStatusButton from '@/components/ask/ContextStatusButton';
import type { ContextUsageMetadata } from '@/lib/agent/stream-consumer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function renderMarkup(element: React.ReactNode): Promise<string> {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(element));
    const trigger = host.querySelector('button');
    if (trigger) await act(async () => trigger.click());
    return host.innerHTML + (document.querySelector('[role="dialog"]')?.outerHTML ?? '');
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
}

const language = vi.hoisted(() => ({ locale: 'zh' }));
beforeEach(() => { language.locale = 'zh'; });

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: language.locale,
  }),
}));

describe('ContextStatusButton', () => {
  it('renders as a compact icon-status button with context window tooltip details', async () => {
    const html = await renderMarkup(
      <ContextStatusButton
        usage={{
          runtime: 'mindos',
          phase: 'preflight',
          action: 'history_pruned',
          modelName: 'step-3.7',
          percent: 28,
          usedTokens: 36_000,
          contextWindow: 128_000,
          nativeContextWindow: 256_000,
          contextTokens: 128_000,
          contextWindowSource: 'catalog',
          contextWindowIsFallback: false,
          budgetTokens: 112_000,
          reserveTokens: 16_000,
          keepRecentTokens: 20_000,
          systemPromptTokens: 8_000,
          turnPromptTokens: 12_000,
          historyTokens: 16_000,
          prunedMessages: 2,
        }}
      />,
    );

    expect(html).toContain('h-11 w-11');
    expect(html).toContain('h-[18px] w-[18px]');
    expect(html).toContain('aria-label="上下文占用 28%，上下文窗口: 128K tokens，已占用: 36K · 可用: 92K"');
    expect(html).toContain('上下文占用 28%');
    expect(html).toContain('上下文窗口: 128K tokens');
    expect(html).toContain('已占用: 36K · 可用: 92K');
    expect(html).toContain('窗口来源: 模型目录');
    expect(html).toContain('原生窗口: 256K tokens');
    expect(html).toContain('有效上限: 128K tokens');
    expect(html).toContain('已裁剪历史');
    expect(html).not.toContain('73<span');
  });

  it('labels fallback context windows as conservative estimates', async () => {
    const html = await renderMarkup(
      <ContextStatusButton
        usage={{
          runtime: 'mindos',
          phase: 'preflight',
          action: 'prompt_truncated',
          modelName: 'unknown-model',
          percent: 99,
          usedTokens: 127_000,
          contextWindow: 128_000,
          contextWindowSource: 'fallback',
          contextWindowIsFallback: true,
          budgetTokens: 111_616,
          reserveTokens: 16_384,
          systemPromptTokens: 10_000,
          turnPromptTokens: 101_616,
          historyTokens: 0,
        }}
      />,
    );

    expect(html).toContain('窗口来源: 保守估算');
    expect(html).toContain('未知模型窗口，MindOS 使用保守预算。');
  });

  it('labels semantic history compaction distinctly from emergency pruning', async () => {
    const html = await renderMarkup(
      <ContextStatusButton
        usage={{
          runtime: 'mindos',
          phase: 'preflight',
          action: 'history_compacted',
          modelName: 'local-model',
          percent: 82,
          usedTokens: 82_000,
          contextWindow: 100_000,
          contextWindowSource: 'model',
          contextWindowIsFallback: false,
          budgetTokens: 84_000,
          reserveTokens: 16_000,
          keepRecentTokens: 20_000,
          systemPromptTokens: 10_000,
          turnPromptTokens: 12_000,
          historyTokens: 60_000,
          runtimeMessageCompaction: true,
          compactedMessages: 8,
          historyCompactTokens: 60_000,
          historyBeforeCompactTokens: 140_000,
        }}
      />,
    );

    expect(html).toContain('已压缩历史消息: 8');
    expect(html).toContain('运行时历史压缩: 开启');
    expect(html).toContain('已压缩历史');
    expect(html).not.toContain('已裁剪历史');
  });

  it('explains when history compaction is delegated to the runtime', async () => {
    const html = await renderMarkup(
      <ContextStatusButton
        usage={{
          runtime: 'mindos',
          phase: 'preflight',
          action: 'none',
          modelName: 'local-model',
          percent: 126,
          usedTokens: 126_000,
          contextWindow: 100_000,
          contextWindowSource: 'model',
          contextWindowIsFallback: false,
          budgetTokens: 84_000,
          reserveTokens: 16_000,
          keepRecentTokens: 20_000,
          systemPromptTokens: 10_000,
          turnPromptTokens: 14_000,
          historyTokens: 102_000,
          runtimeMessageCompaction: true,
        }}
      />,
    );

    expect(html).toContain('运行时历史压缩: 开启');
    expect(html).toContain('历史将交由运行时按需压缩');
    expect(html).not.toContain('无需裁剪');
  });

  it('renders nothing when context usage is unavailable', async () => {
    const html = await renderMarkup(<ContextStatusButton usage={null} />);

    expect(html).toBe('');
  });

  const usage: ContextUsageMetadata = { phase: 'preflight', action: 'none', percent: 42, usedTokens: 42_000, contextWindow: 100_000, budgetTokens: 84_000, reserveTokens: 16_000, systemPromptTokens: 10_000, turnPromptTokens: 12_000, historyTokens: 20_000 };

  it('describes context capacity rather than indexing progress in English too', async () => {
    language.locale = 'en';
    const html = await renderMarkup(<ContextStatusButton usage={usage} />);
    expect(html).toContain('Context used 42%');
    expect(html).not.toContain('Indexing');
  });

  it.each([NaN, Infinity, -1, 73])('keeps the percentage consistent with token counts when the reported ratio is %s', async percent => {
    const html = await renderMarkup(<ContextStatusButton usage={{ ...usage, percent }} />);
    expect(html).toContain('上下文占用 42%');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it.each([{ usedTokens: NaN }, { usedTokens: -1 }, { contextWindow: 0 }, { contextWindow: Infinity }])('shows unavailable instead of a fabricated zero for invalid counts %j', async values => {
    const html = await renderMarkup(<ContextStatusButton usage={{ ...usage, ...values }} />);
    expect(html).toContain('上下文用量暂不可用');
    expect(html).not.toMatch(/NaN|Infinity|占用 0%/);
  });

  it('distinguishes a real zero and retains over-capacity usage without inventing free capacity', async () => {
    expect(await renderMarkup(<ContextStatusButton usage={{ ...usage, usedTokens: 0 }} />)).toContain('上下文占用 0%');
    const over = await renderMarkup(<ContextStatusButton usage={{ ...usage, usedTokens: 126_000 }} />);
    expect(over).toContain('上下文占用 126%');
    expect(over).toContain('可用: 0');
    expect(over).toContain('stroke-dashoffset="0"');
  });
});
