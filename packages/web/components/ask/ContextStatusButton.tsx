'use client';

import { Popover } from '@base-ui/react/popover';
import { useRef } from 'react';
import { X } from 'lucide-react';
import type { ContextUsageMetadata } from '@/lib/agent/stream-consumer';
import { useLocale } from '@/lib/stores/locale-store';

interface ContextStatusButtonProps {
  usage: ContextUsageMetadata | null | undefined;
}

function formatTokenCount(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const normalized = Math.max(0, Math.round(value ?? 0));
  if (normalized >= 1_000_000) return `${(normalized / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (normalized >= 1_000) return `${(normalized / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${normalized}`;
}

function usagePercent(usage: ContextUsageMetadata): number | null {
  if (!Number.isFinite(usage.usedTokens) || usage.usedTokens < 0
    || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return null;
  // Keep the headline consistent with the displayed numerator and denominator.
  const percent = usage.usedTokens / usage.contextWindow * 100;
  return Number.isFinite(percent) ? Math.round(percent) : null;
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
  const percent = usagePercent(usage);
  if (percent === null) return [locale === 'zh' ? '上下文用量暂不可用' : 'Context usage unavailable'];
  const used = Math.max(0, Math.round(usage.usedTokens));
  const contextWindow = Math.max(0, Math.round(usage.contextWindow));
  const available = Math.max(0, contextWindow - used);
  const source = contextWindowSourceLabel(usage.contextWindowSource, locale);
  const maxHistoryTokens = Math.max(0, usage.budgetTokens - usage.systemPromptTokens - usage.turnPromptTokens);
  const runtimeWillCompactHistory = usage.runtimeMessageCompaction === true
    && usage.action === 'none'
    && usage.historyTokens > maxHistoryTokens;

  if (locale === 'zh') {
    return [
      `上下文占用 ${percent}%`,
      `上下文窗口: ${formatTokenCount(contextWindow)} tokens`,
      `已占用: ${formatTokenCount(used)} · 可用: ${formatTokenCount(available)}`,
      `窗口来源: ${source}`,
      usage.nativeContextWindow !== undefined ? `原生窗口: ${formatTokenCount(usage.nativeContextWindow)} tokens` : '',
      usage.contextTokens !== undefined ? `有效上限: ${formatTokenCount(usage.contextTokens)} tokens` : '',
      usage.contextWindowIsFallback ? '未知模型窗口，MindOS 使用保守预算。' : '',
      usage.runtimeMessageCompaction !== undefined ? `运行时历史压缩: ${usage.runtimeMessageCompaction ? '开启' : '关闭'}` : '',
      usage.compactedMessages !== undefined ? `已压缩历史消息: ${formatTokenCount(usage.compactedMessages)}` : '',
      runtimeWillCompactHistory ? '历史将交由运行时按需压缩' : contextActionLabel(usage.action, locale),
    ].filter(Boolean);
  }

  return [
    `Context used ${percent}%`,
    `Context window: ${formatTokenCount(contextWindow)} tokens`,
    `Used: ${formatTokenCount(used)} · Available: ${formatTokenCount(available)}`,
    `Window source: ${source}`,
    usage.nativeContextWindow !== undefined ? `Native window: ${formatTokenCount(usage.nativeContextWindow)} tokens` : '',
    usage.contextTokens !== undefined ? `Effective cap: ${formatTokenCount(usage.contextTokens)} tokens` : '',
    usage.contextWindowIsFallback ? 'Unknown model window; MindOS used the conservative fallback budget.' : '',
    usage.runtimeMessageCompaction !== undefined ? `Runtime history compaction: ${usage.runtimeMessageCompaction ? 'on' : 'off'}` : '',
    usage.compactedMessages !== undefined ? `Compacted history messages: ${formatTokenCount(usage.compactedMessages)}` : '',
    runtimeWillCompactHistory ? 'History will be compacted by the runtime as needed' : contextActionLabel(usage.action, locale),
  ].filter(Boolean);
}

export default function ContextStatusButton({ usage }: ContextStatusButtonProps) {
  const { locale } = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  if (!usage) return null;

  const percent = usagePercent(usage) ?? 0;
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clampedPercent / 100);
  const tooltipLines = buildTooltipLines(usage, locale);
  const ariaLabel = tooltipLines.slice(0, 3).join(locale === 'zh' ? '，' : '; ');

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-75 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={ariaLabel}
        title={tooltipLines[0]}
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} collisionPadding={12} collisionAvoidance={{ side: 'shift', align: 'shift', fallbackAxisSide: 'none' }} className="z-50">
          <Popover.Popup initialFocus={closeRef} className="flex w-[min(20rem,calc(100vw-1.5rem))] max-h-[var(--available-height)] flex-col overflow-hidden rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg focus-visible:outline-none">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <Popover.Title className="text-sm font-medium">{tooltipLines[0]}</Popover.Title>
              <Popover.Close ref={closeRef} aria-label={locale === 'zh' ? '关闭上下文用量' : 'Close context usage'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={16} /></Popover.Close>
            </div>
            {tooltipLines.length > 1 && (
              <div className="min-h-0 overflow-y-auto pb-1 text-xs leading-relaxed text-muted-foreground">
                {tooltipLines.slice(1).map((line, index) => <p key={line} className={index === 2 ? 'mt-2' : undefined}>{line}</p>)}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
