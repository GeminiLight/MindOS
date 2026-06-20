'use client';

/**
 * Shared types and helpers for Agent Activity UI components.
 * Used by both AgentActivitySection (full audit log) and RecentActivityFeed (compact list).
 */

import { AlertCircle, CheckCircle2, ChevronDown, Clock, FileEdit, FilePlus, Search, Terminal, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentOp {
  id?: string;
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  agentName?: string;
}

export type OpKind = 'read' | 'write' | 'create' | 'delete' | 'search' | 'other';

export const ACTIVITY_FILTER_KINDS: Array<OpKind | 'all'> = ['all', 'write', 'create', 'delete', 'read', 'search'];

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function opKind(tool: string): OpKind {
  if (/search/.test(tool)) return 'search';
  if (/read|list|get/.test(tool)) return 'read';
  if (/create/.test(tool)) return 'create';
  if (/delete/.test(tool)) return 'delete';
  if (/write|update|insert|append/.test(tool)) return 'write';
  return 'other';
}

export const KIND_LABEL: Record<string, Record<OpKind, string>> = {
  en: { read: 'Read', write: 'Write', create: 'Create', delete: 'Delete', search: 'Search', other: 'Other' },
  zh: { read: '读取', write: '写入', create: '创建', delete: '删除', search: '搜索', other: '其他' },
};

export const KIND_TONE_CLASS: Record<OpKind, string> = {
  read: 'border-[var(--tool-read)]/25 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
  write: 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]',
  create: 'border-success/25 bg-success/10 text-success',
  delete: 'border-error/25 bg-error/10 text-error',
  search: 'border-[var(--tool-search)]/25 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
  other: 'border-border bg-muted text-muted-foreground',
};

export const KIND_COLOR: Record<OpKind, string> = {
  read: 'text-[var(--tool-read)]',
  write: 'text-[var(--amber)]',
  create: 'text-success',
  delete: 'text-error',
  search: 'text-[var(--tool-search)]',
  other: 'text-muted-foreground',
};

export function OpIcon({ kind, size = 13 }: { kind: OpKind; size?: number }) {
  if (kind === 'read')   return <Clock size={size} />;
  if (kind === 'write')  return <FileEdit size={size} />;
  if (kind === 'create') return <FilePlus size={size} />;
  if (kind === 'delete') return <Trash2 size={size} />;
  if (kind === 'search') return <Search size={size} />;
  return <Terminal size={size} />;
}

export function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

export function relativeTs(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${d}d`;
}

export function getFilePath(params: Record<string, unknown>): string | null {
  return typeof params.path === 'string' ? params.path : null;
}

export function truncateContent(v: unknown, max = 120): string {
  let content: string;
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    content = s ?? String(v);
  } catch {
    content = String(v);
  }
  return content.length > max ? content.slice(0, max) + '\u2026' : content;
}

function langFromLocale(locale?: string): 'en' | 'zh' {
  return locale?.startsWith('zh') ? 'zh' : 'en';
}

function resultToneClass(result: AgentOp['result']): string {
  return result === 'error'
    ? 'border-error/25 bg-error/10 text-error'
    : 'border-success/25 bg-success/10 text-success';
}

/** Compact colored badge showing operation kind with icon + localized label. */
export function KindBadge({ kind, locale, size = 'md', className }: { kind: OpKind; locale?: string; size?: 'sm' | 'md'; className?: string }) {
  const lang = langFromLocale(locale);
  const label = KIND_LABEL[lang][kind];
  const iconSize = size === 'sm' ? 9 : 10;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border font-mono font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-px text-[0.6rem]' : 'px-2 py-0.5 text-[0.68rem]',
        KIND_TONE_CLASS[kind],
        className,
      )}
    >
      <OpIcon kind={kind} size={iconSize} />
      {label}
    </span>
  );
}

export function AgentActivityFilterBar({
  kinds = ACTIVITY_FILTER_KINDS,
  counts,
  active,
  onChange,
  locale,
  className,
}: {
  kinds?: Array<OpKind | 'all'>;
  counts: Record<string, number>;
  active: OpKind | 'all';
  onChange: (kind: OpKind | 'all') => void;
  locale?: string;
  className?: string;
}) {
  const lang = langFromLocale(locale);

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {kinds.map(kind => {
        const count = counts[kind] ?? 0;
        if (kind !== 'all' && !count) return null;
        const isActive = active === kind;
        const label = kind === 'all' ? (lang === 'zh' ? '全部' : 'All') : KIND_LABEL[lang][kind];

        return (
          <button
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.7rem] font-mono font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive && kind !== 'all' && KIND_TONE_CLASS[kind],
              isActive && kind === 'all' && 'border-border bg-accent text-foreground',
              !isActive && 'border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {kind !== 'all' && <OpIcon kind={kind} size={10} />}
            <span>{label}</span>
            <span className="opacity-60">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

export function AgentActivityEmptyState({
  title,
  hint,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-4 py-12 text-center text-muted-foreground', className)}>
      <Terminal size={28} className="mx-auto mb-2.5 opacity-30" />
      <p className="text-xs font-medium">{title}</p>
      {hint && <p className="mt-1.5 text-[0.68rem] leading-relaxed text-muted-foreground/65">{hint}</p>}
    </div>
  );
}

export function AgentActivityOpCard({
  op,
  locale,
  agentLabel = 'Agent',
  showToolName = false,
}: {
  op: AgentOp;
  locale?: string;
  agentLabel?: string;
  showToolName?: boolean;
}) {
  const smoothPush = useSmoothRouterPush();
  const [expanded, setExpanded] = useState(false);
  const kind = opKind(op.tool);
  const filePath = getFilePath(op.params);
  const toolShort = op.tool.replace(/^mindos_/, '');
  const shouldShowTool = showToolName || !filePath;

  const toggleExpanded = () => setExpanded(v => !v);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={toggleExpanded}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <KindBadge kind={kind} locale={locale} />

        {shouldShowTool && (
          <span className="shrink-0 truncate text-[0.78rem] font-mono font-semibold text-foreground" title={op.tool}>
            {toolShort}
          </span>
        )}

        {filePath && (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left font-mono text-xs text-[var(--amber)] transition-colors hover:text-[var(--amber-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={event => {
              event.stopPropagation();
              smoothPush('/view/' + filePath.split('/').map(encodeURIComponent).join('/'));
            }}
            onKeyDown={event => event.stopPropagation()}
            title={filePath}
          >
            {filePath}
          </button>
        )}

        {!filePath && <span className="min-w-0 flex-1" />}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {op.agentName && (
            <span className="max-w-[7.5rem] truncate rounded-full bg-muted/70 px-1.5 py-0.5 text-[0.62rem] font-medium text-muted-foreground" title={op.agentName}>
              {op.agentName.length > 30 ? op.agentName.slice(0, 30) + '...' : op.agentName}
            </span>
          )}
          {op.result === 'ok'
            ? <CheckCircle2 size={13} className="text-success" />
            : <AlertCircle size={13} className="text-error" />
          }
          <span className="text-[0.68rem] tabular-nums text-muted-foreground/60" title={formatTs(op.ts)}>
            {relativeTs(op.ts)}
          </span>
          <ChevronDown size={12} className={cn('text-muted-foreground transition-transform duration-150', expanded && 'rotate-180')} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-background px-3.5 py-2.5">
          <div className={cn('flex flex-col gap-1', op.message && 'mb-2')}>
            {Object.entries(op.params).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
                <span className="shrink-0 font-mono text-[0.68rem] text-muted-foreground/70">
                  {key}
                </span>
                <span className="break-all font-mono text-xs leading-relaxed text-foreground">
                  {truncateContent(value)}
                </span>
              </div>
            ))}
          </div>

          {op.message && (
            <div className={cn('mt-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs', resultToneClass(op.result))}>
              {op.message}
            </div>
          )}

          {op.agentName && (
            <div className="mt-1.5 text-[0.68rem] text-muted-foreground">
              {agentLabel}: <span className="font-medium text-foreground">{op.agentName}</span>
            </div>
          )}

          <div className="mt-1.5 text-[0.65rem] tabular-nums text-muted-foreground/50">
            {formatTs(op.ts)}
          </div>
        </div>
      )}
    </div>
  );
}
