'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  AlertCircle,
  Trash2,
  ChevronDown,
  FileText,
  Clock,
  Archive,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  loadHistory,
  clearHistory,
  type OrganizeHistoryEntry,
  type OrganizeSource,
} from '@/lib/organize-history';

export default function InboxHistoryPage() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<OrganizeHistoryEntry[]>(() => loadHistory());

  const handleClear = useCallback(() => {
    if (!confirm(t.importHistory.clearConfirm)) return;
    clearHistory();
    setEntries([]);
  }, [t]);

  const grouped = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    const groups: { label: string; entries: OrganizeHistoryEntry[] }[] = [];
    let currentLabel = '';
    let currentGroup: OrganizeHistoryEntry[] = [];

    for (const entry of entries) {
      const d = new Date(entry.timestamp);
      const dateStr = d.toDateString();
      let label: string;
      if (dateStr === todayStr) label = t.importHistory.today;
      else if (dateStr === yesterdayStr) label = t.importHistory.yesterday;
      else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

      if (label !== currentLabel) {
        if (currentGroup.length > 0) groups.push({ label: currentLabel, entries: currentGroup });
        currentLabel = label;
        currentGroup = [entry];
      } else {
        currentGroup.push(entry);
      }
    }
    if (currentGroup.length > 0) groups.push({ label: currentLabel, entries: currentGroup });
    return groups;
  }, [entries, t]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/wiki"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{t.importHistory.title}</h1>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {entries.length > 0
              ? t.importHistory.recordCount(entries.length)
              : t.importHistory.emptyTitle}
          </p>
        </div>
        {entries.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[var(--error)] transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            {t.importHistory.clearAll}
          </button>
        )}
      </div>

      {/* Archive notice */}
      {entries.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2.5 mb-6 rounded-lg bg-muted/30 border border-border/30">
          <Archive size={13} className="text-muted-foreground/50 mt-0.5 shrink-0" />
          <p className="text-2xs text-muted-foreground/60">
            {t.importHistory.processedArchive}
          </p>
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Clock size={32} className="text-muted-foreground/15" />
          <p className="text-sm text-muted-foreground/60">{t.importHistory.emptyTitle}</p>
          <p className="text-xs text-muted-foreground/40">{t.importHistory.emptyDesc}</p>
        </div>
      )}

      {/* Grouped entries */}
      <div className="space-y-6">
        {grouped.map((group) => (
          <div key={group.label}>
            <h2 className="text-2xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              {group.label}
            </h2>
            <div className="space-y-2">
              {group.entries.map((entry) => (
                <HistoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryCard({ entry }: { entry: OrganizeHistoryEntry }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const isUndone = entry.status === 'undone';
  const sourceLabel = getSourceLabel(entry.source);
  const duration = entry.durationMs ? formatDuration(entry.durationMs) : null;
  const time = new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const successCount = entry.files.filter(f => f.ok && !f.undone).length;
  const totalCount = entry.files.length;

  return (
    <div className="rounded-xl border border-border/40 overflow-hidden hover:border-border/60 transition-colors">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
      >
        {isUndone ? (
          <AlertCircle size={14} className="text-muted-foreground/40 mt-0.5 shrink-0" />
        ) : (
          <Check size={14} className="text-success/70 mt-0.5 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className={`text-sm ${isUndone ? 'text-muted-foreground/50 line-through' : 'text-foreground/90'}`}>
            {entry.sourceFiles.length === 1
              ? entry.sourceFiles[0]
              : `${entry.sourceFiles.length} files`}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {sourceLabel && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground/60">
                {sourceLabel}
              </span>
            )}
            {totalCount > 0 && (
              <span className="text-2xs text-muted-foreground/40">
                {t.importHistory.changesCount(successCount, totalCount)}
              </span>
            )}
            {duration && (
              <span className="text-2xs text-muted-foreground/40">{duration}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-2xs text-muted-foreground/40 tabular-nums">{time}</span>
          {totalCount > 0 && (
            <ChevronDown
              size={12}
              className={`text-muted-foreground/30 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
            />
          )}
        </div>
      </button>

      {expanded && totalCount > 0 && (
        <div className="border-t border-border/20 px-4 py-2 space-y-1">
          {/* Source files */}
          {entry.sourceFiles.length > 1 && (
            <div className="mb-2">
              <span className="text-2xs font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t.importHistory.sourceLabel}
              </span>
              <div className="mt-1 space-y-0.5">
                {entry.sourceFiles.map((name, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-2xs text-foreground/60">
                    <FileText size={10} className="text-muted-foreground/40 shrink-0" />
                    <span className="truncate">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Changes */}
          {entry.files.map((f, idx) => {
            const fileName = f.path.split('/').pop() ?? f.path;
            return (
              <div
                key={`${f.path}-${idx}`}
                className={`flex items-center gap-2 py-1 text-2xs ${f.undone ? 'opacity-40' : ''}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  f.ok && !f.undone ? 'bg-success/60' : f.undone ? 'bg-muted-foreground/30' : 'bg-[var(--error)]/50'
                }`} />
                <span className={`truncate flex-1 ${f.undone ? 'line-through text-muted-foreground' : 'text-foreground/70'}`}>
                  {f.path}
                </span>
                <span className="text-muted-foreground/40 shrink-0">
                  {f.undone ? 'undone' : f.action === 'create' ? 'created' : f.action === 'update' ? 'updated' : f.action}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getSourceLabel(source?: OrganizeSource): string | null {
  switch (source) {
    case 'drag-drop': return 'Drag & Drop';
    case 'inbox-organize': return 'Inbox';
    case 'import-modal': return 'Import';
    case 'plugin': return 'Plugin';
    case 'upload': return 'Upload';
    default: return null;
  }
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem > 0 ? `${rem}s` : ''}`;
}
