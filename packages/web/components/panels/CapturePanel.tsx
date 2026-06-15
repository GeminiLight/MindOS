'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ChevronRight, FileText, History, ListChecks, Plus } from 'lucide-react';
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
  const view = hash.split('?', 1)[0];
  return view === 'queue' || view === 'shelved' || view === 'history' ? view : 'capture';
}

function getCapturePanelHref(view: CapturePanelView, selectedPath?: string): string {
  if (view === 'capture') return '/capture';
  const params = selectedPath ? `?path=${encodeURIComponent(selectedPath)}` : '';
  return `/capture#${view}${params}`;
}

function dispatchSyntheticHashChange(oldUrl: string, newUrl: string) {
  if (oldUrl === newUrl) return;
  const event = typeof HashChangeEvent === 'function'
    ? new HashChangeEvent('hashchange', { oldURL: oldUrl, newURL: newUrl })
    : new Event('hashchange');
  window.dispatchEvent(event);
}

export default function CapturePanel() {
  const { t } = useLocale();
  const router = useRouter();
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
  const navigateToView = useCallback((view: CapturePanelView, selectedPath?: string) => {
    const href = getCapturePanelHref(view, selectedPath);
    setActiveView(view);

    if (typeof window !== 'undefined' && window.location.pathname === '/capture') {
      const oldUrl = window.location.href;
      window.history.pushState(null, '', href);
      dispatchSyntheticHashChange(oldUrl, window.location.href);
      return;
    }

    router.push(href);
  }, [router]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t.sidebar.capture} />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="px-1">
          <button
            type="button"
            onClick={() => navigateToView('capture')}
            className="relative z-10 flex min-h-10 w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-2 text-xs font-semibold text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            aria-current={activeView === 'capture' ? 'page' : undefined}
            data-inbox-sidebar-new-capture
          >
            <Plus size={13} />
            {t.inbox.viewCapture}
          </button>
        </div>

        <nav className="mt-4" aria-label={t.inbox.title}>
          <p className="mb-1.5 px-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">
            {t.inbox.sidebarProcessTitle}
          </p>
          <div className="space-y-1">
            <CapturePanelLink
              icon={ListChecks}
              title={t.inbox.viewQueue}
              active={activeView === 'queue'}
              count={pendingFiles.length}
              emphasized={pendingFiles.length > 0}
              onSelect={() => navigateToView('queue')}
            />
            <CapturePanelLink
              icon={Archive}
              title={t.inbox.viewShelved}
              active={activeView === 'shelved'}
              count={shelvedFiles.length}
              onSelect={() => navigateToView('shelved')}
            />
            <CapturePanelLink
              icon={History}
              title={t.inbox.viewHistory}
              active={activeView === 'history'}
              count={history.length}
              onSelect={() => navigateToView('history')}
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
            <div className="overflow-hidden rounded-xl border border-border/50 bg-card/35">
              <div className="divide-y divide-border/45">
                {previewFiles.map(file => (
                  <CapturePreviewFile
                    key={file.path}
                    file={file}
                    agingLabel={t.inbox.agingHint}
                    reviewLabel={t.inbox.viewQueue}
                    onSelect={() => navigateToView('queue', file.path)}
                  />
                ))}
              </div>
              {pendingFiles.length > previewFiles.length && (
                <button
                  type="button"
                  onClick={() => navigateToView('queue')}
                  className="flex min-h-9 w-full touch-manipulation items-center justify-between border-t border-border/45 px-3 py-2 text-2xs font-medium text-muted-foreground/60 transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span>{t.inbox.more(pendingFiles.length - previewFiles.length)}</span>
                  <ChevronRight size={12} />
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function CapturePanelLink({
  icon: Icon,
  title,
  active,
  count,
  emphasized,
  onSelect,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  active?: boolean;
  count?: number;
  emphasized?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative z-10 flex min-h-10 w-full touch-manipulation items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-[var(--amber)]/45 bg-[var(--amber-subtle)] text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/45'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={13} className={`shrink-0 ${active ? 'text-[var(--amber)]' : 'text-muted-foreground/60 group-hover:text-foreground/70'}`} />
      <span className={`min-w-0 flex-1 truncate text-xs font-medium ${active ? 'text-foreground' : 'text-foreground/85'}`}>{title}</span>
      {typeof count === 'number' && count > 0 && (
        <span className={`rounded-full px-1.5 py-px text-2xs font-medium tabular-nums ${
          active
            ? 'bg-background/75 text-[var(--amber-text)]'
            : emphasized
              ? 'bg-[var(--amber)]/10 text-[var(--amber)]/75'
              : 'bg-muted/55 text-muted-foreground/75'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

function CapturePreviewFile({
  file,
  agingLabel,
  reviewLabel,
  onSelect,
}: {
  file: InboxFile;
  agingLabel: string;
  reviewLabel: string;
  onSelect: () => void;
}) {
  const sizeLabel = formatCompactSize(file.size);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${reviewLabel}: ${file.name}`}
      className="flex min-h-11 w-full touch-manipulation items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
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
    </button>
  );
}

function formatCompactSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size / (1024 * 1024))} MB`;
}
