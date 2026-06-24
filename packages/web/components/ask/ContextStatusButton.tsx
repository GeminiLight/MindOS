'use client';

import { useId } from 'react';
import type { ContextUsageMetadata } from '@/lib/agent/stream-consumer';
import { useLocale } from '@/lib/stores/locale-store';

interface ContextStatusButtonProps {
  usage: ContextUsageMetadata | null | undefined;
}

function formatTokenCount(value: number | undefined): string {
  if (!Number.isFinite(value)) return '0';
  const normalized = Math.max(0, Math.round(value ?? 0));
  if (normalized >= 1_000_000) return `${(normalized / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (normalized >= 1_000) return `${(normalized / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${normalized}`;
}

function contextActionLabel(action: ContextUsageMetadata['action'], locale: string): string {
  if (locale === 'zh') {
    if (action === 'prompt_compacted') return '已压缩提示词';
    if (action === 'prompt_truncated') return '已截断提示词';
    if (action === 'history_compacted') return '已压缩历史';
    if (action === 'history_pruned') return '已裁剪历史';
    if (action === 'history_compacted_history_pruned') return '已压缩并裁剪历史';
    if (action === 'prompt_compacted_history_compacted') return '已压缩提示词和历史';
    if (action === 'prompt_compacted_history_pruned') return '已压缩提示词并裁剪历史';
    if (action === 'prompt_compacted_history_compacted_history_pruned') return '已压缩提示词，并压缩/裁剪历史';
    if (action === 'prompt_truncated_history_compacted') return '已截断提示词并压缩历史';
    if (action === 'prompt_truncated_history_pruned') return '已截断提示词并裁剪历史';
    if (action === 'prompt_truncated_history_compacted_history_pruned') return '已截断提示词，并压缩/裁剪历史';
    return '无需裁剪';
  }
  if (action === 'prompt_compacted') return 'Prompt compacted';
  if (action === 'prompt_truncated') return 'Prompt truncated';
  if (action === 'history_compacted') return 'History compacted';
  if (action === 'history_pruned') return 'History pruned';
  if (action === 'history_compacted_history_pruned') return 'History compacted + pruned';
  if (action === 'prompt_compacted_history_compacted') return 'Prompt compacted + history compacted';
  if (action === 'prompt_compacted_history_pruned') return 'Prompt compacted + history pruned';
  if (action === 'prompt_compacted_history_compacted_history_pruned') return 'Prompt compacted + history compacted/pruned';
  if (action === 'prompt_truncated_history_compacted') return 'Prompt truncated + history compacted';
  if (action === 'prompt_truncated_history_pruned') return 'Prompt truncated + history pruned';
  if (action === 'prompt_truncated_history_compacted_history_pruned') return 'Prompt truncated + history compacted/pruned';
  return 'No pruning';
}

function contextWindowSourceLabel(source: ContextUsageMetadata['contextWindowSource'], locale: string): string {
  if (locale === 'zh') {
    if (source === 'user') return '用户配置';
    if (source === 'catalog') return '模型目录';
    if (source === 'discovered') return '实时发现';
    if (source === 'pi-ai') return 'pi-ai 注册表';
    if (source === 'model') return '运行时模型';
    if (source === 'fallback') return '保守估算';
    return '运行时元数据';
  }
  if (source === 'user') return 'user config';
  if (source === 'catalog') return 'model catalog';
  if (source === 'discovered') return 'live discovery';
  if (source === 'pi-ai') return 'pi-ai registry';
  if (source === 'model') return 'runtime model';
  if (source === 'fallback') return 'fallback estimate';
  return 'runtime metadata';
}

function buildTooltipLines(usage: ContextUsageMetadata, locale: string): string[] {
  const percent = Math.max(0, Math.round(usage.percent));
  const used = Math.max(0, Math.round(usage.usedTokens));
  const contextWindow = Math.max(0, Math.round(usage.contextWindow));
  const available = Math.max(0, contextWindow - used);
  const source = contextWindowSourceLabel(usage.contextWindowSource, locale);

  if (locale === 'zh') {
    return [
      `索引中 ${percent}%`,
      `上下文窗口: ${formatTokenCount(contextWindow)} tokens`,
      `已占用: ${formatTokenCount(used)} · 可用: ${formatTokenCount(available)}`,
      `窗口来源: ${source}`,
      usage.nativeContextWindow !== undefined ? `原生窗口: ${formatTokenCount(usage.nativeContextWindow)} tokens` : '',
      usage.contextTokens !== undefined ? `有效上限: ${formatTokenCount(usage.contextTokens)} tokens` : '',
      usage.contextWindowIsFallback ? '未知模型窗口，MindOS 使用保守预算。' : '',
      usage.compactedMessages !== undefined ? `已压缩历史消息: ${formatTokenCount(usage.compactedMessages)}` : '',
      contextActionLabel(usage.action, locale),
    ].filter(Boolean);
  }

  return [
    `Indexing ${percent}%`,
    `Context window: ${formatTokenCount(contextWindow)} tokens`,
    `Used: ${formatTokenCount(used)} · Available: ${formatTokenCount(available)}`,
    `Window source: ${source}`,
    usage.nativeContextWindow !== undefined ? `Native window: ${formatTokenCount(usage.nativeContextWindow)} tokens` : '',
    usage.contextTokens !== undefined ? `Effective cap: ${formatTokenCount(usage.contextTokens)} tokens` : '',
    usage.contextWindowIsFallback ? 'Unknown model window; MindOS used the conservative fallback budget.' : '',
    usage.compactedMessages !== undefined ? `Compacted history messages: ${formatTokenCount(usage.compactedMessages)}` : '',
    contextActionLabel(usage.action, locale),
  ].filter(Boolean);
}

export default function ContextStatusButton({ usage }: ContextStatusButtonProps) {
  const { locale } = useLocale();
  const tooltipId = useId();
  if (!usage) return null;

  const percent = Math.max(0, Math.round(usage.percent));
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clampedPercent / 100);
  const tooltipLines = buildTooltipLines(usage, locale);
  const ariaLabel = tooltipLines.slice(0, 3).join('，');

  return (
    <div className="group/context-status relative z-20 inline-flex h-7 w-7 shrink-0 items-center justify-center">
      <button
        type="button"
        className="hit-target-box relative z-10 inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-active-bg:color-mix(in_srgb,var(--amber)_8%,transparent)]"
        aria-label={ariaLabel}
        aria-describedby={tooltipId}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-[18px] w-[18px] -rotate-90"
        >
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-border/80"
          />
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="var(--amber)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="opacity-80"
          />
        </svg>
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 hidden w-56 -translate-x-1/2 rounded-md border border-border/60 bg-popover px-3 py-2 text-left text-[11px] leading-relaxed text-popover-foreground shadow-lg group-hover/context-status:block group-focus-within/context-status:block"
      >
        <div className="font-medium text-foreground">{tooltipLines[0]}</div>
        <div className="mt-1 text-muted-foreground">{tooltipLines[1]}</div>
        <div className="text-muted-foreground">{tooltipLines[2]}</div>
        {tooltipLines.slice(3).map((line, index) => (
          <div key={line} className={index === 0 ? 'mt-1 text-2xs text-muted-foreground/70' : 'text-2xs text-muted-foreground/70'}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
