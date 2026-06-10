'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronRight, FileText, History, Inbox, ListChecks, Plus } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/stores/locale-store';
import { loadHistory, type OrganizeHistoryEntry } from '@/lib/organize-history';
import { fetchInboxFiles } from '@/lib/inbox-client';
import {
  INBOX_SHELVED_STORAGE_KEY,
  INBOX_SHELVED_UPDATED_EVENT,
  normalizeShelvedInboxPaths,
  readShelvedInboxPaths,
  writeShelvedInboxPaths,
} from '@/lib/inbox-shelved';

type InboxFile = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging?: boolean;
};

type CapturePanelView = 'capture' | 'queue' | 'shelved' | 'history';

function getCurrentPanelView(): CapturePanelView {
  if (typeof window === 'undefined') return 'capture';
  if (window.location.pathname === '/capture/history') return 'history';
  const hash = window.location.hash.replace('#', '');
  return hash === 'queue' || hash === 'shelved' || hash === 'history' ? hash : 'capture';
}

export default function CapturePanel() {
  const { t } = useLocale();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [history, setHistory] = useState<OrganizeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<CapturePanelView>(() => getCurrentPanelView());
  const [shelvedPaths, setShelvedPaths] = useState<string[]>(() => readShelvedInboxPaths());
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
    const syncShelvedPaths = () => setShelvedPaths(readShelvedInboxPaths());
    const syncStorage = (event: StorageEvent) => {
      if (event.key === INBOX_SHELVED_STORAGE_KEY) syncShelvedPaths();
    };
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
    window.addEventListener(INBOX_SHELVED_UPDATED_EVENT, syncShelvedPaths);
    window.addEventListener('storage', syncStorage);
    window.addEventListener('hashchange', syncView);
    window.addEventListener('popstate', syncView);
    return () => {
      cancelled = true;
      clearTimeout(refreshTimerRef.current);
      window.removeEventListener('mindos:inbox-updated', refresh);
      window.removeEventListener('mindos:organize-done', refresh);
      window.removeEventListener('mindos:organize-history-update', refreshHistory);
      window.removeEventListener('mindos:inbox-files', syncInboxFiles);
      window.removeEventListener(INBOX_SHELVED_UPDATED_EVENT, syncShelvedPaths);
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('hashchange', syncView);
      window.removeEventListener('popstate', syncView);
    };
  }, [fetchInbox, refresh, refreshHistory]);

  useEffect(() => {
    if (loading || inboxError) return;
    const validPaths = new Set(files.map(file => file.path));
    const normalized = normalizeShelvedInboxPaths(shelvedPaths, validPaths);
    if (normalized.length !== shelvedPaths.length || normalized.some((path, index) => path !== shelvedPaths[index])) {
      setShelvedPaths(writeShelvedInboxPaths(normalized));
    }
  }, [files, inboxError, loading, shelvedPaths]);

  const shelvedPathSet = useMemo(() => new Set(shelvedPaths), [shelvedPaths]);
  const pendingFiles = useMemo(() => files.filter(file => !shelvedPathSet.has(file.path)), [files, shelvedPathSet]);
  const shelvedFiles = useMemo(() => files.filter(file => shelvedPathSet.has(file.path)), [files, shelvedPathSet]);
  const agingCount = useMemo(() => pendingFiles.filter(file => file.isAging).length, [pendingFiles]);
  const previewFiles = useMemo(() => pendingFiles.slice(0, 5), [pendingFiles]);
  const reviewDesc = inboxError ? t.inbox.loadFailed : loading ? t.inbox.sidebarLoadingDesc : t.inbox.sidebarQueueDesc(pendingFiles.length);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t.sidebar.capture} />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <section className="rounded-xl border border-border/55 bg-card/45 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
                <Inbox size={14} />
              </span>
              <div className="min-w-0 pt-0.5">
                <h3 className="truncate text-sm font-semibold text-foreground">{t.inbox.title}</h3>
                <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground/60">{t.inbox.sidebarPanelDesc}</p>
              </div>
            </div>
            {pendingFiles.length > 0 && (
              <span className="rounded-full bg-[var(--amber)]/10 px-2 py-0.5 text-2xs font-semibold tabular-nums text-[var(--amber)]">
                {pendingFiles.length}
              </span>
            )}
          </div>
          <Link
            href="/capture"
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-2 text-xs font-semibold text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            aria-current={activeView === 'capture' ? 'page' : undefined}
          >
            <Plus size={13} />
            {t.inbox.viewCapture}
          </Link>
        </section>

        <nav className="mt-4" aria-label={t.inbox.title}>
          <p className="mb-1.5 px-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">
            {t.inbox.sidebarProcessTitle}
          </p>
          <div className="space-y-1">
            <CapturePanelLink
              href="/capture#queue"
              icon={ListChecks}
              title={t.inbox.viewQueue}
              desc={reviewDesc}
              active={activeView === 'queue'}
              count={pendingFiles.length}
              emphasized={pendingFiles.length > 0}
            />
            <CapturePanelLink
              href="/capture#shelved"
              icon={Archive}
              title={t.inbox.viewShelved}
              desc={t.inbox.sidebarShelvedDesc(shelvedFiles.length)}
              active={activeView === 'shelved'}
              count={shelvedFiles.length}
            />
            <CapturePanelLink
              href="/capture#history"
              icon={History}
              title={t.inbox.viewHistory}
              desc={t.inbox.sidebarHistoryDesc(history.length)}
              active={activeView === 'history'}
              count={history.length}
            />
          </div>
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
              {pendingFiles.length > previewFiles.length && (
                <div className="flex items-center justify-between px-3 py-2 text-2xs font-medium text-muted-foreground/60">
                  <span>{t.inbox.more(pendingFiles.length - previewFiles.length)}</span>
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
