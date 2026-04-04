'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Sparkles,
  FileText,
  Table,
  AlertCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { encodePath } from '@/lib/utils';

interface InboxFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging: boolean;
}

interface InboxSectionProps {
  isOrganizing?: boolean;
}

const VISIBLE_LIMIT = 5;

export function InboxSection({ isOrganizing: externalOrganizing = false }: InboxSectionProps) {
  const { t } = useLocale();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const isOrganizing = externalOrganizing || organizing;

  const handleOrganize = useCallback(() => {
    if (files.length === 0 || isOrganizing) return;
    setOrganizing(true);
    window.dispatchEvent(
      new CustomEvent('mindos:inbox-organize', { detail: { files } }),
    );
  }, [files, isOrganizing]);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.files)) {
        setFiles(data.files);
      }
    } catch (err) {
      console.warn('[InboxSection] Failed to fetch inbox:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debouncedRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(fetchInbox, 80);
  }, [fetchInbox]);

  useEffect(() => {
    fetchInbox();

    const onOrganizeDone = () => { setOrganizing(false); debouncedRefresh(); };

    window.addEventListener('mindos:files-changed', debouncedRefresh);
    window.addEventListener('mindos:inbox-updated', debouncedRefresh);
    window.addEventListener('mindos:organize-done', onOrganizeDone);
    return () => {
      clearTimeout(refreshTimerRef.current);
      window.removeEventListener('mindos:files-changed', debouncedRefresh);
      window.removeEventListener('mindos:inbox-updated', debouncedRefresh);
      window.removeEventListener('mindos:organize-done', onOrganizeDone);
    };
  }, [fetchInbox, debouncedRefresh]);

  const visibleFiles = useMemo(
    () => (showAll ? files : files.slice(0, VISIBLE_LIMIT)),
    [files, showAll],
  );
  const hiddenCount = files.length - VISIBLE_LIMIT;

  if (loading) return null;

  return (
    <section className="mb-10">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[var(--amber)]">
          <Inbox size={13} />
        </span>
        <h2 className="text-sm font-semibold font-display text-foreground">
          {t.inbox.title}
        </h2>
        {files.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-2xs font-semibold rounded-full bg-[var(--amber)]/15 text-[var(--amber)] tabular-nums font-display">
            {t.inbox.count(files.length)}
          </span>
        )}
        {files.length > 0 && (
          <div className="ml-auto">
            <button
              onClick={handleOrganize}
              disabled={isOrganizing}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-colors hover:opacity-80 cursor-pointer font-display disabled:opacity-50 disabled:cursor-not-allowed"
              title={isOrganizing ? t.inbox.organizing : undefined}
            >
              {isOrganizing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              <span>{isOrganizing ? t.inbox.organizing : t.inbox.organizeButton}</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center">
          <Inbox size={24} className="mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/70 font-display">
            {t.inbox.emptyTitle}
          </p>
          <p className="text-xs text-muted-foreground/40 mt-1">
            {t.inbox.emptyDesc}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            {visibleFiles.map((file) => (
              <InboxFileRow key={file.path} file={file} />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer font-display"
            >
              <ChevronRight
                size={12}
                className={`transition-transform duration-150 ${showAll ? 'rotate-90' : ''}`}
              />
              {showAll ? t.home.showLess : t.inbox.more(hiddenCount)}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function InboxFileRow({ file }: { file: InboxFile }) {
  const { t } = useLocale();
  const isCSV = file.name.endsWith('.csv');
  const age = formatRelativeTime(file.modifiedAt, t.home.relativeTime);

  return (
    <Link
      href={`/view/${encodePath(file.path)}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100 hover:translate-x-0.5 hover:bg-muted group"
    >
      {/* Dot indicator */}
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          file.isAging ? 'bg-[var(--amber)]/60' : 'bg-[var(--amber)]'
        }`}
      />
      {/* Icon */}
      {isCSV ? (
        <Table size={12} className="shrink-0 text-success" />
      ) : (
        <FileText size={12} className="shrink-0 text-muted-foreground" />
      )}
      {/* Name */}
      <span
        className="text-sm truncate flex-1 text-foreground"
        title={file.name}
        suppressHydrationWarning
      >
        {file.name}
      </span>
      {/* Time */}
      <span className="text-2xs text-muted-foreground/50 tabular-nums shrink-0 font-display">
        {age}
      </span>
      {/* Aging warning */}
      {file.isAging && (
        <span title="7+ days">
          <AlertCircle
            size={11}
            className="shrink-0 text-[var(--amber)]/60"
          />
        </span>
      )}
    </Link>
  );
}

interface RelativeTimeStrings {
  justNow: string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
}

function formatRelativeTime(isoString: string, rt: RelativeTimeStrings): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return rt.justNow;
  if (minutes < 60) return rt.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rt.hoursAgo(hours);
  const days = Math.floor(hours / 24);
  return rt.daysAgo(days);
}
