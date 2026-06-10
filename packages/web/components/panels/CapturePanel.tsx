'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, History, Inbox, ListChecks, Plus } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/stores/locale-store';
import { loadHistory, type OrganizeHistoryEntry } from '@/lib/organize-history';
import { fetchInboxFiles } from '@/lib/inbox-client';

type InboxFile = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging?: boolean;
};

type CapturePanelView = 'capture' | 'queue' | 'history';

function getCurrentPanelView(): CapturePanelView {
  if (typeof window === 'undefined') return 'capture';
  if (window.location.pathname === '/capture/history') return 'history';
  const hash = window.location.hash.replace('#', '');
  return hash === 'queue' || hash === 'history' ? hash : 'capture';
}

export default function CapturePanel() {
  const { t } = useLocale();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [history, setHistory] = useState<OrganizeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<CapturePanelView>(() => getCurrentPanelView());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchSeqRef = useRef(0);
  const inboxFilesEventSeqRef = useRef(0);

  const refreshHistory = useCallback(() => {
    setHistory(loadHistory());
  }, []);

  const fetchInbox = useCallback(async () => {
    const fetchSeq = ++fetchSeqRef.current;
    const eventSeqAtStart = inboxFilesEventSeqRef.current;
    const shouldApplyFetch = () => (
      fetchSeq === fetchSeqRef.current &&
      inboxFilesEventSeqRef.current === eventSeqAtStart
    );

    try {
      const nextFiles = await fetchInboxFiles(t.inbox.loadFailed);
      if (!shouldApplyFetch()) return;
      setFiles(nextFiles);
      setInboxError(null);
    } catch (error) {
      if (!shouldApplyFetch()) return;
      console.warn('[CapturePanel] fetch failed:', error);
      setInboxError(error instanceof Error ? error.message : t.inbox.loadFailed);
    } finally {
      if (shouldApplyFetch()) setLoading(false);
    }
  }, [t]);

  const refresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void fetchInbox();
      refreshHistory();
    }, 80);
  }, [fetchInbox, refreshHistory]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void fetchInbox();
      refreshHistory();
    });

    const syncView = () => setActiveView(getCurrentPanelView());
    const syncInboxFiles = (event: Event) => {
      const nextFiles = (event as CustomEvent<InboxFile[]>).detail;
      if (!Array.isArray(nextFiles)) return;
      inboxFilesEventSeqRef.current += 1;
      setFiles(nextFiles);
      setInboxError(null);
      setLoading(false);
    };
    window.addEventListener('mindos:inbox-updated', refresh);
    window.addEventListener('mindos:organize-done', refresh);
    window.addEventListener('mindos:organize-history-update', refreshHistory);
    window.addEventListener('mindos:inbox-files', syncInboxFiles);
    window.addEventListener('hashchange', syncView);
    window.addEventListener('popstate', syncView);
    return () => {
      cancelled = true;
      clearTimeout(refreshTimerRef.current);
      window.removeEventListener('mindos:inbox-updated', refresh);
      window.removeEventListener('mindos:organize-done', refresh);
      window.removeEventListener('mindos:organize-history-update', refreshHistory);
      window.removeEventListener('mindos:inbox-files', syncInboxFiles);
      window.removeEventListener('hashchange', syncView);
      window.removeEventListener('popstate', syncView);
    };
  }, [fetchInbox, refresh, refreshHistory]);

  const agingCount = useMemo(() => files.filter(file => file.isAging).length, [files]);
  const previewFiles = useMemo(() => files.slice(0, 3), [files]);
  const reviewDesc = inboxError ? t.inbox.loadFailed : loading ? t.inbox.sidebarLoadingDesc : t.inbox.sidebarQueueDesc(files.length);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t.sidebar.capture} />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <section className="rounded-xl border border-border/55 bg-card/45 p-3 shadow-sm">
          <div className="flex items-start gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
              <Inbox size={14} />
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-xs font-semibold text-foreground">{t.inbox.sidebarPanelDesc}</h3>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <CaptureMetric active={files.length > 0} label={t.inbox.pendingSequenceTitle} value={String(files.length)} />
            <CaptureMetric label={t.inbox.recentProcessedTitle} value={String(history.length)} />
          </div>
        </section>

        <nav className="mt-3 space-y-1.5" aria-label={t.inbox.title}>
          <CapturePanelLink
            href="/capture"
            icon={Plus}
            title={t.inbox.viewCapture}
            desc={t.inbox.sidebarCaptureDesc}
            active={activeView === 'capture'}
          />
          <CapturePanelLink
            href="/capture#queue"
            icon={ListChecks}
            title={t.inbox.viewQueue}
            desc={reviewDesc}
            active={activeView === 'queue'}
            count={files.length}
            emphasized={files.length > 0}
          />
          <CapturePanelLink
            href="/capture#history"
            icon={History}
            title={t.inbox.viewHistory}
            desc={t.inbox.sidebarHistoryDesc(history.length)}
            active={activeView === 'history'}
            count={history.length}
          />
        </nav>

        {inboxError && (
          <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-2xs leading-relaxed text-error">
            {inboxError}
          </div>
        )}

        {previewFiles.length > 0 && (
          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">
                {t.inbox.sidebarNextTitle}
              </p>
              {agingCount > 0 && (
                <span className="text-2xs font-medium text-[var(--amber)]/70">
                  {agingCount} {t.inbox.agingCountLabel}
                </span>
              )}
            </div>
            <Link
              href="/capture#queue"
              className="block overflow-hidden rounded-xl border border-border/50 bg-card/35 transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="divide-y divide-border/45">
                {previewFiles.map(file => (
                  <CapturePreviewFile key={file.path} file={file} agingLabel={t.inbox.agingHint} />
                ))}
              </div>
              {files.length > previewFiles.length && (
                <div className="flex items-center justify-between px-3 py-2 text-2xs font-medium text-muted-foreground/60">
                  <span>{t.inbox.more(files.length - previewFiles.length)}</span>
                  <ChevronRight size={12} />
                </div>
              )}
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}

function CapturePanelLink({
  href,
  icon: Icon,
  title,
  desc,
  active,
  count,
  emphasized,
}: {
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  desc: string;
  active?: boolean;
  count?: number;
  emphasized?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-[var(--amber)]/45 bg-[var(--amber-subtle)] text-foreground'
          : emphasized
            ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)]/45 hover:bg-[var(--amber-subtle)]/65'
            : 'border-transparent text-muted-foreground hover:bg-muted/45'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={13} className={`mt-0.5 shrink-0 ${active || emphasized ? 'text-[var(--amber)]' : 'text-muted-foreground/60 group-hover:text-foreground/70'}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-xs font-medium ${active || emphasized ? 'text-foreground' : 'text-foreground/85'}`}>{title}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground/60">{desc}</span>
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="mt-0.5 rounded-full bg-background px-1.5 py-px text-2xs font-medium text-muted-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}

function CaptureMetric({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${active ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)]/45' : 'border-border/35 bg-muted/25'}`}>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-2xs text-muted-foreground/60">{label}</p>
    </div>
  );
}

function CapturePreviewFile({ file, agingLabel }: { file: InboxFile; agingLabel: string }) {
  const sizeLabel = formatCompactSize(file.size);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <FileText size={12} className="shrink-0 text-muted-foreground/45" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground/85" title={file.name}>
          {file.name}
        </p>
        <p className="mt-0.5 text-2xs tabular-nums text-muted-foreground/45">
          {sizeLabel}
        </p>
      </div>
      {file.isAging && (
        <span
          className="shrink-0 rounded bg-[var(--amber)]/10 px-1.5 py-px text-2xs font-medium text-[var(--amber)]/70"
          title={agingLabel}
        >
          7+
        </span>
      )}
    </div>
  );
}

function formatCompactSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size / (1024 * 1024))} MB`;
}
