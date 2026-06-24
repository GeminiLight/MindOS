// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ContextStatusButton from '@/components/ask/ContextStatusButton';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'zh' as const,
  }),
}));

describe('ContextStatusButton', () => {
  it('renders as a compact icon-status button with context window tooltip details', () => {
    const html = renderToStaticMarkup(
      <ContextStatusButton
        usage={{
          runtime: 'mindos',
          phase: 'preflight',
          action: 'history_pruned',
          modelName: 'step-3.7',
          percent: 73,
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

    expect(html).toContain('h-7 w-7');
    expect(html).toContain('h-[18px] w-[18px]');
    expect(html).toContain('aria-label="索引中 73%，上下文窗口: 128K tokens，已占用: 36K · 可用: 92K"');
    expect(html).toContain('索引中 73%');
    expect(html).toContain('上下文窗口: 128K tokens');
    expect(html).toContain('已占用: 36K · 可用: 92K');
    expect(html).toContain('窗口来源: 模型目录');
    expect(html).toContain('原生窗口: 256K tokens');
    expect(html).toContain('有效上限: 128K tokens');
    expect(html).toContain('已裁剪历史');
    expect(html).not.toContain('73<span');
  });

  it('labels fallback context windows as conservative estimates', () => {
    const html = renderToStaticMarkup(
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

  it('labels semantic history compaction distinctly from emergency pruning', () => {
    const html = renderToStaticMarkup(
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

  it('explains when history compaction is delegated to the runtime', () => {
    const html = renderToStaticMarkup(
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

  it('renders nothing when context usage is unavailable', () => {
    const html = renderToStaticMarkup(<ContextStatusButton usage={null} />);

    expect(html).toBe('');
  });
});
