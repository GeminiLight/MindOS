'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Inbox,
  Sparkles,
  FileText,
  FileCode,
  Table,
  AlertCircle,
  Loader2,
  Upload,
  FolderInput,
  Check,
  ChevronDown,
  X,
  ExternalLink,
  Copy,
  Trash2,
  ArrowLeft,
  History,
  BookOpen,
  ListChecks,
  Archive,
  ArrowRight,
  Paperclip,
  Eye,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { quickDropToInbox, clipUrlToInbox, looksLikeUrl, extractUrlFromDrop, dragContainsUrl } from '@/lib/inbox-upload';
import { loadHistory, type OrganizeHistoryEntry, type OrganizeSource } from '@/lib/organize-history';
import { CAPTURE_ACCEPT } from '@/lib/capture-formats';
import CustomSelect from '@/components/CustomSelect';
import ProviderModelCapsule, { getPersistedProviderModel, type ProviderSelection } from '@/components/ask/ProviderModelCapsule';
import { useInboxOrganize } from '@/components/inbox/InboxOrganizeContext';
import { SourceIcon, getInboxSourceLabel } from '@/components/inbox/SourceIcon';
import { archiveInboxFiles, fetchInboxFiles, saveInboxFiles, type InboxFileSourceInfo } from '@/lib/inbox-client';

interface InboxFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging: boolean;
  source?: InboxFileSourceInfo;
}

const HISTORY_VISIBLE = 5;
const REVIEW_PREVIEW_VISIBLE = 5;
const INBOX_PROVIDER_MODEL_STORAGE_KEY = 'mindos-inbox-provider-model';

type CaptureIntent = 'source' | 'note' | 'judgment' | 'reflect';
type InboxViewMode = 'capture' | 'queue' | 'history';
type LastSavedSummary = { saved: number; failed: number };

const EXT_STYLES: Record<string, { bg: string; text: string }> = {
  md:   { bg: 'bg-blue-500/10',    text: 'text-blue-500/70' },
  txt:  { bg: 'bg-muted/50',       text: 'text-muted-foreground/60' },
  csv:  { bg: 'bg-emerald-500/10', text: 'text-emerald-500/70' },
  json: { bg: 'bg-violet-500/10',  text: 'text-violet-500/70' },
  pdf:  { bg: 'bg-error/10',       text: 'text-error/60' },
};

function getFileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function getFileBaseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function getInitialInboxViewMode(): InboxViewMode {
  if (typeof window === 'undefined') return 'capture';
  const hash = window.location.hash.replace('#', '');
  return hash === 'queue' || hash === 'history' ? hash : 'capture';
}

export default function InboxView() {
  const { t } = useLocale();
  const router = useRouter();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<OrganizeHistoryEntry[]>([]);
  const [draftText, setDraftText] = useState('');
  const [selectedIntent, setSelectedIntent] = useState<CaptureIntent>('source');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [savingText, setSavingText] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedQueuePaths, setSelectedQueuePaths] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<InboxViewMode>(() => getInitialInboxViewMode());
  const [lastSavedSummary, setLastSavedSummary] = useState<LastSavedSummary | null>(null);
  const [providerOverride, setProviderOverride] = useState<ProviderSelection>(
    () => getPersistedProviderModel(INBOX_PROVIDER_MODEL_STORAGE_KEY).provider,
  );
  const [modelOverride, setModelOverride] = useState<string | null>(
    () => getPersistedProviderModel(INBOX_PROVIDER_MODEL_STORAGE_KEY).model,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewSectionRef = useRef<HTMLElement>(null);
  const dragCounterRef = useRef(0);
  const inboxOrganize = useInboxOrganize();
  const organizing = inboxOrganize.isOrganizing;

  const fetchInbox = useCallback(async () => {
    try {
      const nextFiles = await fetchInboxFiles(t.inbox.loadFailed);
      const nextPathSet = new Set(nextFiles.map(file => file.path));
      setFiles(nextFiles);
      setSelectedPath(prev => (prev && nextPathSet.has(prev) ? prev : null));
      setSelectedQueuePaths(prev => {
        const retained = prev.filter(path => nextPathSet.has(path));
        return retained.length === prev.length ? prev : retained;
      });
      setInboxError(null);
      window.dispatchEvent(new CustomEvent('mindos:inbox-files', { detail: nextFiles }));
    } catch (err) {
      console.warn('[InboxView] fetch failed:', err);
      setInboxError(err instanceof Error ? err.message : t.inbox.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const refreshHistory = useCallback(() => {
    setHistory(loadHistory());
  }, []);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const debouncedRefresh = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchInbox();
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

    const onOrganizeDone = () => { debouncedRefresh(); };
    const resetDrag = () => { dragCounterRef.current = 0; setDragOver(false); };

    window.addEventListener('mindos:files-changed', debouncedRefresh);
    window.addEventListener('mindos:inbox-updated', debouncedRefresh);
    window.addEventListener('mindos:organize-done', onOrganizeDone);
    window.addEventListener('mindos:organize-history-update', refreshHistory);
    window.addEventListener('drop', resetDrag, true);
    window.addEventListener('dragend', resetDrag, true);
    return () => {
      cancelled = true;
      clearTimeout(refreshTimerRef.current);
      window.removeEventListener('mindos:files-changed', debouncedRefresh);
      window.removeEventListener('mindos:inbox-updated', debouncedRefresh);
      window.removeEventListener('mindos:organize-done', onOrganizeDone);
      window.removeEventListener('mindos:organize-history-update', refreshHistory);
      window.removeEventListener('drop', resetDrag, true);
      window.removeEventListener('dragend', resetDrag, true);
    };
  }, [fetchInbox, debouncedRefresh, refreshHistory]);

  const handleOrganizeSelected = useCallback(() => {
    const selectedPathSet = new Set(selectedQueuePaths);
    const selectedFiles = files.filter(file => selectedPathSet.has(file.path));
    if (selectedFiles.length === 0 || organizing) return;
    void inboxOrganize.requestInboxOrganize(selectedFiles, {
      providerOverride,
      modelOverride,
    });
  }, [files, inboxOrganize, modelOverride, organizing, providerOverride, selectedQueuePaths]);

  const handleDeleteFile = useCallback(async (name: string) => {
    const removedPathSet = new Set(files.filter(file => file.name === name).map(file => file.path));
    try {
      const result = await archiveInboxFiles([name], t.inbox.fileRemoveFailed);
      if (!result.archived.some(item => item.original === name)) {
        throw new Error(t.inbox.fileRemoveFailed);
      }
      setFiles(prev => prev.filter(f => f.name !== name));
      setSelectedPath(prev => (prev && removedPathSet.has(prev) ? null : prev));
      setSelectedQueuePaths(prev => prev.filter(path => !removedPathSet.has(path)));
      window.dispatchEvent(new Event('mindos:inbox-updated'));
      toast.success(t.inbox.fileRemoved);
    } catch {
      toast.error(t.inbox.fileRemoveFailed);
    }
  }, [files, t]);

  const addPendingFiles = useCallback((selected: FileList | File[] | null) => {
    if (!selected || selected.length === 0) return;
    setPendingFiles(prev => {
      const existing = new Set(prev.map(file => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...prev];
      for (const file of Array.from(selected)) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!existing.has(key)) next.push(file);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const addPendingUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!looksLikeUrl(trimmed)) return false;
    setPendingUrls(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    return true;
  }, []);

  const handleCapture = useCallback(async () => {
    const content = draftText.trim();
    if ((!content && pendingFiles.length === 0 && pendingUrls.length === 0) || savingText) return;
    setSavingText(true);
    let savedAny = false;
    let savedCount = 0;
    let failedCount = 0;
    let textSaveFailed = false;
    try {
      if (content) {
        const name = buildCaptureFileName(content, selectedIntent);
        const result = await saveInboxFiles(
          [{ name, content, encoding: 'text' }],
          t.inbox.saveFailed,
          { source: 'text', captureIntent: selectedIntent },
        );
        if (result.saved.length > 0 && result.skipped.length === 0) {
          savedAny = true;
          savedCount += result.saved.length;
          setDraftText('');
        } else {
          failedCount += Math.max(1, result.skipped.length);
          textSaveFailed = true;
        }
      }
      const failedUrls: string[] = [];
      for (const url of pendingUrls) {
        const result = await clipUrlToInbox(url, t);
        if (result.ok) {
          savedAny = true;
          savedCount += 1;
        } else {
          failedCount += 1;
          failedUrls.push(url);
        }
      }
      setPendingUrls(failedUrls);
      if (pendingFiles.length > 0) {
        const result = await quickDropToInbox(pendingFiles, t);
        if (result.saved.length > 0) {
          savedAny = true;
          savedCount += result.saved.length;
          setPendingFiles(prev => removeSavedPendingFiles(prev, result.saved.map(item => item.original)));
        }
        failedCount += result.skipped.length + result.oversized.length + result.unreadable.length;
      }
      if (savedAny) {
        setLastSavedSummary({ saved: savedCount, failed: failedCount });
        await fetchInbox();
        window.dispatchEvent(new Event('mindos:inbox-updated'));
      }
      if (content && !textSaveFailed && pendingUrls.length === 0 && pendingFiles.length === 0) {
        toast.success(t.inbox.textSaved, 3000);
      }
      if (textSaveFailed) {
        toast.error(savedAny ? t.inbox.capturePartialFailed : t.inbox.saveFailed, 4000);
      }
    } catch {
      toast.error(t.inbox.saveFailed, 4000);
    } finally {
      setSavingText(false);
    }
  }, [draftText, pendingFiles, pendingUrls, selectedIntent, savingText, fetchInbox, t]);

  const handleComposerPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      addPendingFiles(files);
      return;
    }
    const pasted = e.clipboardData.getData('text/plain').trim();
    if (pasted && looksLikeUrl(pasted)) {
      e.preventDefault();
      addPendingUrl(pasted);
    }
  }, [addPendingFiles, addPendingUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);

    const droppedUrl = extractUrlFromDrop(e.nativeEvent);
    if (droppedUrl) {
      addPendingUrl(droppedUrl);
      return;
    }

    if (e.dataTransfer.files.length > 0) {
      addPendingFiles(Array.from(e.dataTransfer.files));
    }
  }, [addPendingFiles, addPendingUrl]);

  const agingCount = useMemo(() => files.filter(f => f.isAging).length, [files]);
  const hasFiles = files.length > 0;
  const selectedQueuePathSet = useMemo(() => new Set(selectedQueuePaths), [selectedQueuePaths]);
  const selectedQueueFiles = useMemo(
    () => files.filter(file => selectedQueuePathSet.has(file.path)),
    [files, selectedQueuePathSet],
  );
  const selectedFile = useMemo(
    () => files.find(f => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );
  const selectedUnderstanding = useMemo(
    () => selectedFile ? buildUnderstanding(selectedFile, t.inbox, inferInboxFileIntent(selectedFile)) : null,
    [selectedFile, t],
  );
  const intentOptions = useMemo(() => getIntentOptions(t.inbox), [t]);
  const intentSelectOptions = useMemo(() => intentOptions.map(intent => ({
    value: intent.id,
    label: intent.title,
  })), [intentOptions]);
  const selectedIntentOption = intentOptions.find(intent => intent.id === selectedIntent) ?? intentOptions[0];
  const suggestedIntent = useMemo(
    () => inferSuggestedIntent(draftText, pendingUrls, pendingFiles),
    [draftText, pendingUrls, pendingFiles],
  );
  const suggestedIntentOption = intentOptions.find(intent => intent.id === suggestedIntent) ?? intentOptions[0];
  const showSuggestedIntent = suggestedIntent !== selectedIntent;
  const hasPendingCapture = draftText.trim().length > 0 || pendingFiles.length > 0 || pendingUrls.length > 0;
  const textWordCount = countWords(draftText);
  const stagedCaptureCount = (draftText.trim() ? 1 : 0) + pendingUrls.length + pendingFiles.length;
  const visibleHistory = useMemo(() => history.slice(0, HISTORY_VISIBLE), [history]);
  const [animateList, setAnimateList] = useState(true);
  const prevFileCountRef = useRef(0);
  useEffect(() => {
    if (prevFileCountRef.current > 0 && files.length > 0) setAnimateList(false);
    prevFileCountRef.current = files.length;
  }, [files.length]);

  useEffect(() => {
    const syncHash = () => setActiveView(getInitialInboxViewMode());
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const switchView = useCallback((view: InboxViewMode) => {
    setActiveView(view);
    if (typeof window === 'undefined') return;
    const nextUrl = view === 'capture'
      ? window.location.pathname
      : `${window.location.pathname}#${view}`;
    window.history.replaceState(null, '', nextUrl);
  }, []);
  const openQueueWorkbench = useCallback((path?: string) => {
    if (path) setSelectedPath(path);
    switchView('queue');
  }, [switchView]);
  const scrollToReviewPreview = useCallback(() => {
    if (activeView !== 'capture') {
      switchView('capture');
    }
    window.requestAnimationFrame(() => {
      reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [activeView, switchView]);
  const pageTitle = activeView === 'capture'
    ? t.inbox.capturePageTitle
    : activeView === 'queue'
      ? t.inbox.reviewPageTitle
      : t.inbox.donePageTitle;
  const pageSubtitle = activeView === 'capture'
    ? t.inbox.capturePageSubtitle
    : activeView === 'queue'
      ? t.inbox.reviewPageSubtitle
      : t.inbox.donePageSubtitle;
  const toggleQueueSelection = useCallback((file: InboxFile) => {
    setSelectedQueuePaths(prev => (
      prev.includes(file.path)
        ? prev.filter(path => path !== file.path)
        : [...prev, file.path]
    ));
  }, []);

  const selectAllQueueFiles = useCallback(() => {
    setSelectedQueuePaths(files.map(file => file.path));
  }, [files]);

  const selectAgingQueueFiles = useCallback(() => {
    setSelectedQueuePaths(files.filter(file => file.isAging).map(file => file.path));
  }, [files]);

  const clearQueueSelection = useCallback(() => {
    setSelectedQueuePaths([]);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="sticky top-[52px] md:top-0 z-20 border-b border-border h-[46px] flex items-center bg-background">
          <div className="w-full px-4 md:px-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 bg-muted rounded animate-pulse" />
              <div className="h-5 w-32 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="flex-1 px-4 md:px-6 py-8">
          <div className="max-w-[780px] mx-auto space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-muted/40 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={CAPTURE_ACCEPT}
        className="hidden"
        onChange={(e) => addPendingFiles(e.target.files)}
      />

      {/* ─── Sticky Top Bar ─── */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border h-[46px] flex items-center bg-background">
        <div className="w-full px-4 md:px-6 flex items-center justify-between">
          {/* Left: Back + Title + file count (horizontal) */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Back */}
            <button
              onClick={() => router.push('/wiki')}
              className="p-1.5 -ml-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={t.inbox.backToWiki}
              aria-label={t.inbox.backToWiki}
            >
              <ArrowLeft size={16} />
            </button>

            {/* Title area — icon + title + file count inline */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)] shrink-0">
                <Inbox size={15} />
              </div>
              <h1 className="text-sm font-semibold text-foreground tracking-tight leading-tight shrink-0">
                {t.inbox.title}
              </h1>
              {hasFiles && (
                <span className="hidden sm:inline text-2xs text-muted-foreground/60 leading-tight shrink-0">
                  {t.inbox.fileCount(files.length)}
                  {agingCount > 0 && (
                    <span className="text-[var(--amber)]/70"> · {agingCount} {t.inbox.agingCountLabel}</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {activeView !== 'capture' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                title={t.inbox.uploadButton}
              >
                <Upload size={13} />
                <span className="hidden sm:inline">{t.inbox.uploadButton}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex-1 px-4 md:px-6 py-6">
        <div className="mx-auto max-w-[1320px] space-y-5">
          <div className="max-w-2xl">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-[var(--amber)]/80">
                {t.inbox.title}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {pageTitle}
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {pageSubtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <InboxViewTab
              active={activeView === 'capture'}
              icon={BookOpen}
              label={t.inbox.viewCapture}
              onClick={() => switchView('capture')}
            />
            <InboxViewTab
              active={activeView === 'queue'}
              icon={ListChecks}
              label={t.inbox.viewQueue}
              count={files.length}
              onClick={() => switchView('queue')}
            />
            <InboxViewTab
              active={activeView === 'history'}
              icon={History}
              label={t.inbox.viewHistory}
              count={history.length}
              onClick={() => switchView('history')}
            />
          </div>

          {inboxError && (
            <InboxErrorBanner
              message={inboxError}
              retryLabel={t.inbox.retry}
              onRetry={() => {
                setLoading(true);
                void fetchInbox();
              }}
            />
          )}

          <div className={
            activeView === 'queue'
              ? 'grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_350px] 2xl:grid-cols-[minmax(0,1.08fr)_380px]'
              : activeView === 'capture'
                ? 'grid max-w-[1120px] gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start'
                : 'max-w-[760px]'
          }>
            <div className="min-w-0 space-y-5">
              {activeView === 'capture' && (
                <>
                  <div
                    className={`rounded-xl transition-all duration-200 ${
                      dragOver
                        ? 'border border-[var(--amber)] bg-[var(--amber-subtle)] p-3 shadow-[inset_0_0_0_1px_var(--amber)]'
                        : ''
                    }`}
                    onDragEnter={(e) => {
                      const hasDroppedFiles = e.dataTransfer.types.includes('Files');
                      const hasUrl = dragContainsUrl(e.nativeEvent);
                      if (!hasDroppedFiles && !hasUrl) return;
                      e.preventDefault();
                      e.stopPropagation();
                      dragCounterRef.current++;
                      if (dragCounterRef.current === 1) {
                        setDragOver(true);
                      }
                    }}
                    onDragOver={(e) => {
                      const hasDroppedFiles = e.dataTransfer.types.includes('Files');
                      const hasUrl = dragContainsUrl(e.nativeEvent);
                      if (!hasDroppedFiles && !hasUrl) return;
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.stopPropagation();
                      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
                      if (dragCounterRef.current === 0) {
                        setDragOver(false);
                      }
                    }}
                    onDrop={handleDrop}
                  >
                    <div
                      className={`rounded-xl border shadow-sm transition-colors ${
                        dragOver
                          ? 'border-[var(--amber)] bg-[var(--amber-subtle)]'
                          : 'border-border/60 bg-card/70'
                      }`}
                    >
                      <div className="border-b border-border/50 px-3 py-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
                              <FolderInput size={14} />
                            </span>
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-foreground">{t.inbox.composerTitle}</span>
                              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/58">
                                {t.inbox.captureTrustLine}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <label
                              htmlFor="capture-next-action"
                              className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55"
                            >
                              {t.inbox.nextActionTitle}
                            </label>
                            <div className="min-w-[156px]">
                              <CustomSelect
                                id="capture-next-action"
                                value={selectedIntent}
                                onChange={(value) => setSelectedIntent(value as CaptureIntent)}
                                options={intentSelectOptions}
                                size="sm"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          <CaptureAffordance
                            icon={<ExternalLink size={12} />}
                            label={t.inbox.captureAffordanceLink}
                            description={t.inbox.captureAffordanceLinkDesc}
                          />
                          <CaptureAffordance
                            icon={<FileText size={12} />}
                            label={t.inbox.captureAffordanceNote}
                            description={t.inbox.captureAffordanceNoteDesc}
                          />
                          <CaptureAffordance
                            icon={<Paperclip size={12} />}
                            label={t.inbox.captureAffordanceFile}
                            description={t.inbox.captureAffordanceFileDesc}
                          />
                          <CaptureAffordance
                            icon={<Upload size={12} />}
                            label={t.inbox.captureAffordanceDrop}
                            description={t.inbox.captureAffordanceDropDesc}
                          />
                        </div>
                      </div>

                      <textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        onPaste={handleComposerPaste}
                        aria-label={t.inbox.composerInputLabel}
                        placeholder={t.inbox.composerPlaceholder}
                        className="min-h-[84px] w-full resize-y bg-transparent px-3 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/38 focus-visible:ring-0"
                      />

                      {(draftText.trim() || pendingUrls.length > 0 || pendingFiles.length > 0) && (
                        <div className="border-t border-border/40 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
                              {t.inbox.stagedCapturesTitle}
                            </p>
                            <span className="rounded-md bg-muted/45 px-1.5 py-0.5 text-2xs text-muted-foreground">
                              {t.inbox.stagedCaptureCount(stagedCaptureCount)}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {draftText.trim() && (
                              <PendingCaptureRow
                                icon={<FileText size={12} />}
                                label={t.inbox.signalText}
                                detail={t.inbox.pendingText(textWordCount)}
                                status={t.inbox.stagedCaptureStatus}
                                onRemove={() => setDraftText('')}
                              />
                            )}
                            {pendingUrls.map(url => (
                              <PendingCaptureRow
                                key={url}
                                icon={<SourceIcon url={url} size="xs" className="border-0 shadow-none" />}
                                label={t.inbox.pendingUrl}
                                detail={shortenUrl(url)}
                                status={t.inbox.stagedCaptureStatus}
                                onRemove={() => setPendingUrls(prev => prev.filter(item => item !== url))}
                              />
                            ))}
                            {pendingFiles.map(file => (
                              <PendingCaptureRow
                                key={`${file.name}:${file.size}:${file.lastModified}`}
                                icon={<Paperclip size={12} />}
                                label={t.inbox.pendingFile}
                                detail={`${file.name} · ${formatSize(file.size)}`}
                                status={t.inbox.stagedCaptureStatus}
                                onRemove={() => setPendingFiles(prev => prev.filter(item => item !== file))}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 border-t border-border/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground/55">
                          <span>{t.inbox.captureInputKinds}</span>
                          <span className="text-muted-foreground/25">·</span>
                          <span>{t.inbox.captureNoAiHint}</span>
                          {showSuggestedIntent && (
                            <>
                              <span className="text-muted-foreground/25">·</span>
                              <span>{t.inbox.suggestedAction(suggestedIntentOption.title)}</span>
                            </>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {hasPendingCapture && (
                            <button
                              type="button"
                              onClick={() => {
                                setDraftText('');
                                setPendingFiles([]);
                                setPendingUrls([]);
                              }}
                              className="rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {t.inbox.clearComposer}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Paperclip size={13} />
                            {t.inbox.attachButton}
                          </button>
                          <button
                            type="button"
                            onClick={handleCapture}
                            disabled={!hasPendingCapture || savingText}
                            className="flex items-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-2 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {savingText ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                            {savingText
                              ? (stagedCaptureCount > 1 ? t.inbox.savingItems(stagedCaptureCount) : t.inbox.savingText)
                              : (stagedCaptureCount > 1 ? t.inbox.captureButtonCount(stagedCaptureCount) : t.inbox.captureButton)}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {lastSavedSummary && (
                    <InboxLastSavedStrip
                      summary={lastSavedSummary}
                      pendingCount={files.length}
                      onReview={scrollToReviewPreview}
                      onDismiss={() => setLastSavedSummary(null)}
                    />
                  )}
                </>
              )}

              {activeView === 'queue' && (
                <InboxQueueSection
                  variant="workbench"
                  files={files}
                  inboxError={inboxError}
                  animateList={animateList}
                  selectedPath={selectedPath}
                  selectedQueuePaths={selectedQueuePathSet}
                  selectedQueueFiles={selectedQueueFiles}
                  onSelectFile={(file) => setSelectedPath(file.path)}
                  onToggleQueueSelection={toggleQueueSelection}
                  onSelectAll={selectAllQueueFiles}
                  onSelectAging={selectAgingQueueFiles}
                  onClearSelection={clearQueueSelection}
                  onOrganizeSelected={handleOrganizeSelected}
                  onDelete={handleDeleteFile}
                  onRetry={() => {
                    setLoading(true);
                    void fetchInbox();
                  }}
                  onOpenWorkbench={() => openQueueWorkbench()}
                  organizing={organizing}
                  providerOverride={providerOverride}
                  onProviderChange={setProviderOverride}
                  modelOverride={modelOverride}
                  onModelChange={setModelOverride}
                />
              )}

              {activeView === 'history' && (
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <History size={12} className="text-muted-foreground/40" />
                    <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">
                      {t.inbox.doneSectionTitle}
                    </span>
                    {history.length > HISTORY_VISIBLE && (
                      <Link
                        href="/capture/history"
                        className="ml-auto text-2xs text-muted-foreground/50 transition-colors hover:text-[var(--amber)]"
                      >
                        {t.inbox.viewAllHistory(history.length)}
                      </Link>
                    )}
                  </div>
                  {visibleHistory.length > 0 ? (
                    <div className="space-y-2">
                      {visibleHistory.map((entry) => (
                        <HistoryRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-10 text-center">
                      <p className="text-sm font-medium text-foreground/70">{t.inbox.doneEmptyTitle}</p>
                      <p className="mt-1 text-xs text-muted-foreground/55">{t.inbox.doneEmptyDesc}</p>
                    </div>
                  )}
                </section>
              )}
            </div>

            {activeView === 'capture' && (
              <aside className="min-w-0 xl:self-start">
                <InboxCapturePreviewPanel
                  draftText={draftText}
                  pendingUrls={pendingUrls}
                  pendingFiles={pendingFiles}
                  selectedIntentTitle={selectedIntentOption.title}
                  textWordCount={textWordCount}
                  stagedCaptureCount={stagedCaptureCount}
                />
              </aside>
            )}

            {activeView === 'capture' && (
              <div className="min-w-0 xl:col-span-2">
                <InboxQueueSection
                  sectionRef={reviewSectionRef}
                  variant="preview"
                  files={files}
                  inboxError={inboxError}
                  animateList={animateList}
                  selectedPath={selectedPath}
                  onSelectFile={(file) => openQueueWorkbench(file.path)}
                  onDelete={handleDeleteFile}
                  onRetry={() => {
                    setLoading(true);
                    void fetchInbox();
                  }}
                  onOpenWorkbench={() => openQueueWorkbench()}
                />
              </div>
            )}

            {activeView === 'queue' && (
              <aside className="lg:sticky lg:top-[70px] lg:self-start">
                <InboxItemDetailsPanel
                  file={selectedFile}
                  understanding={selectedUnderstanding}
                  onOpen={(file) => router.push(`/view/${encodePath(file.path)}`)}
                  onDelete={(file) => handleDeleteFile(file.name)}
                />
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Capture Confirmation + Queue ─── */

function CaptureAffordance({
  icon,
  label,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/45 bg-background/45 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[var(--amber)]">{icon}</span>
        <span className="truncate text-xs font-medium text-foreground/80">{label}</span>
      </div>
      <p className="mt-0.5 truncate text-2xs text-muted-foreground/55">{description}</p>
    </div>
  );
}

function PendingCaptureRow({
  icon,
  label,
  detail,
  status,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  status: string;
  onRemove: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/45 bg-background/50 px-2.5 py-2">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/50 text-[var(--amber)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-xs font-medium text-foreground/80">{label}</span>
          <span className="min-w-0 truncate text-2xs text-muted-foreground/58">{detail}</span>
        </div>
      </div>
      <span className="hidden shrink-0 rounded-md bg-muted/45 px-1.5 py-0.5 text-2xs text-muted-foreground/55 sm:inline">
        {status}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t.inbox.removeCaptureItem(label)}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function InboxCapturePreviewPanel({
  draftText,
  pendingUrls,
  pendingFiles,
  selectedIntentTitle,
  textWordCount,
  stagedCaptureCount,
}: {
  draftText: string;
  pendingUrls: string[];
  pendingFiles: File[];
  selectedIntentTitle: string;
  textWordCount: number;
  stagedCaptureCount: number;
}) {
  const { t } = useLocale();
  const trimmedText = draftText.trim();
  const primaryUrl = pendingUrls[0];
  const primaryFile = pendingFiles[0];
  const hasText = trimmedText.length > 0;
  const additionalCount = Math.max(0, stagedCaptureCount - 1);

  let body: React.ReactNode;
  if (primaryUrl) {
    const host = getUrlHost(primaryUrl);
    body = (
      <>
        <CapturePreviewIdentity
          icon={<SourceIcon url={primaryUrl} size="md" />}
          title={getInboxSourceLabel(null, primaryUrl) ?? host}
          description={shortenUrl(primaryUrl)}
        />
        <div className="mt-4 divide-y divide-border/35 border-y border-border/35">
          <CapturePreviewFactRow label={t.inbox.sourcePreviewType} value={t.inbox.sourcePreviewWebLink} />
          <CapturePreviewFactRow label={t.inbox.sourcePreviewSaveAs} value={t.inbox.sourcePreviewSourcePreserved} />
          <CapturePreviewFactRow label={t.inbox.sourcePreviewStatus} value={t.inbox.sourcePreviewReviewPending} />
        </div>
      </>
    );
  } else if (primaryFile) {
    const ext = getFileExt(primaryFile.name);
    body = (
      <>
        <CapturePreviewIdentity
          icon={<Paperclip size={15} />}
          title={primaryFile.name}
          description={`${formatSize(primaryFile.size)} · ${ext ? `.${ext}` : t.inbox.sourcePreviewFileType}`}
        />
        <div className="mt-4 divide-y divide-border/35 border-y border-border/35">
          <CapturePreviewFactRow label={t.inbox.sourcePreviewType} value={ext ? `.${ext}` : t.inbox.sourcePreviewFileType} />
          <CapturePreviewFactRow label={t.inbox.sourcePreviewSaveAs} value={t.inbox.sourcePreviewOriginalFile} />
          <CapturePreviewFactRow label={t.inbox.sourcePreviewStatus} value={t.inbox.sourcePreviewReviewPending} />
        </div>
      </>
    );
  } else if (hasText) {
    body = (
      <>
        <CapturePreviewIdentity
          icon={<FileText size={15} />}
          title={t.inbox.sourcePreviewTextCapture}
          description={t.inbox.pendingText(textWordCount)}
        />
        <div className="mt-4 divide-y divide-border/35 border-y border-border/35">
          <CapturePreviewFactRow label={t.inbox.sourcePreviewType} value={t.inbox.sourcePreviewTextType} />
          <CapturePreviewFactRow label={t.inbox.sourcePreviewIntent} value={selectedIntentTitle} />
          <CapturePreviewFactRow label={t.inbox.sourcePreviewStatus} value={t.inbox.sourcePreviewReviewPending} />
        </div>
      </>
    );
  } else {
    body = (
      <div className="py-5 text-center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted/45 text-muted-foreground/55">
          <Inbox size={17} />
        </span>
        <p className="mt-3 text-sm font-medium text-foreground/78">{t.inbox.sourcePreviewEmptyTitle}</p>
        <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground/58">
          {t.inbox.sourcePreviewEmptyDesc}
        </p>
      </div>
    );
  }

  return (
    <section
      className="rounded-xl border border-border/60 bg-card/65 shadow-sm"
      aria-live="polite"
      aria-label={t.inbox.sourcePreviewTitle}
    >
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-[var(--amber)]" />
          <h3 className="text-sm font-semibold text-foreground">{t.inbox.sourcePreviewTitle}</h3>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
          {stagedCaptureCount > 0 ? t.inbox.sourcePreviewActiveDesc : t.inbox.sourcePreviewIdleDesc}
        </p>
      </div>
      <div className="px-4 py-4">
        {body}
        {additionalCount > 0 && (
          <div className="mt-3 rounded-lg border border-border/45 bg-background/50 px-3 py-2 text-xs text-muted-foreground/65">
            {t.inbox.sourcePreviewAlsoStaged(additionalCount)}
          </div>
        )}
      </div>
    </section>
  );
}

function CapturePreviewIdentity({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground" title={title}>{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground/62" title={description}>{description}</p>
      </div>
    </div>
  );
}

function CapturePreviewFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-3 py-2.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">{label}</p>
      <p className="min-w-0 text-xs font-medium leading-snug text-foreground/78">{value}</p>
    </div>
  );
}

function InboxLastSavedStrip({
  summary,
  pendingCount,
  onReview,
  onDismiss,
}: {
  summary: LastSavedSummary;
  pendingCount: number;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  const hasFailures = summary.failed > 0;
  const toneClass = hasFailures
    ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)]'
    : 'border-success/20 bg-success/5';
  const iconClass = hasFailures
    ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
    : 'bg-success/10 text-success';

  return (
    <div className={`flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${toneClass}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
          {hasFailures ? <AlertCircle size={12} /> : <Check size={12} />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {hasFailures
              ? t.inbox.lastSavedPartialTitle(summary.saved, summary.failed)
              : t.inbox.lastSavedTitle(summary.saved)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/65">
            {hasFailures ? t.inbox.lastSavedPartialDesc : t.inbox.lastSavedDesc}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onReview}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.inbox.reviewPendingAction(pendingCount)}
          <ArrowRight size={12} />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t.inbox.dismissLastSaved}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

function InboxQueueSection({
  sectionRef,
  variant,
  files,
  inboxError,
  animateList,
  selectedPath,
  selectedQueuePaths = new Set<string>(),
  selectedQueueFiles = [],
  onSelectFile,
  onToggleQueueSelection,
  onSelectAll,
  onSelectAging,
  onClearSelection,
  onOrganizeSelected,
  onDelete,
  onRetry,
  onOpenWorkbench,
  organizing = false,
  providerOverride = null,
  onProviderChange,
  modelOverride = null,
  onModelChange,
}: {
  sectionRef?: RefObject<HTMLElement | null>;
  variant: 'preview' | 'workbench';
  files: InboxFile[];
  inboxError: string | null;
  animateList: boolean;
  selectedPath: string | null;
  selectedQueuePaths?: Set<string>;
  selectedQueueFiles?: InboxFile[];
  onSelectFile: (file: InboxFile) => void;
  onToggleQueueSelection?: (file: InboxFile) => void;
  onSelectAll?: () => void;
  onSelectAging?: () => void;
  onClearSelection?: () => void;
  onOrganizeSelected?: () => void;
  onDelete: (name: string) => void;
  onRetry: () => void;
  onOpenWorkbench: () => void;
  organizing?: boolean;
  providerOverride?: ProviderSelection;
  onProviderChange?: (provider: ProviderSelection) => void;
  modelOverride?: string | null;
  onModelChange?: (model: string | null) => void;
}) {
  const { t } = useLocale();
  const hasFiles = files.length > 0;
  const isPreview = variant === 'preview';
  const visibleFiles = isPreview ? files.slice(0, REVIEW_PREVIEW_VISIBLE) : files;
  const remainingCount = Math.max(0, files.length - visibleFiles.length);
  const agingCount = files.filter(file => file.isAging).length;

  return (
    <section
      ref={sectionRef}
      className={`rounded-xl border border-border/60 shadow-sm ${
        isPreview ? 'bg-card/35 scroll-mt-20' : 'bg-card/40'
      }`}
    >
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ListChecks size={15} className="text-[var(--amber)]" />
            <h3 className="text-sm font-semibold text-foreground">{t.inbox.queueTitle}</h3>
            {hasFiles && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                {t.inbox.fileCount(files.length)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
            {isPreview ? t.inbox.queuePreviewDesc : t.inbox.reviewPageSubtitle}
          </p>
        </div>
      </div>
      {inboxError ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground/70">{t.inbox.loadFailed}</p>
          <p className="mt-1 text-xs text-muted-foreground/55">{inboxError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.inbox.retry}
          </button>
        </div>
      ) : hasFiles ? (
        <>
          {isPreview && (
            <InboxOrganizationPreviewBar
              files={files}
              agingCount={agingCount}
              onOpenWorkbench={onOpenWorkbench}
            />
          )}
          {!isPreview && onOrganizeSelected && onSelectAll && onSelectAging && onClearSelection && onProviderChange && onModelChange && (
            <InboxOrganizationAgentBar
              files={files}
              selectedFiles={selectedQueueFiles}
              agingCount={agingCount}
              organizing={organizing}
              providerOverride={providerOverride}
              onProviderChange={onProviderChange}
              modelOverride={modelOverride}
              onModelChange={onModelChange}
              onSelectAll={onSelectAll}
              onSelectAging={onSelectAging}
              onClearSelection={onClearSelection}
              onOrganize={onOrganizeSelected}
            />
          )}
          <div className="divide-y divide-border/50">
            {visibleFiles.map((file, idx) => (
              <InboxFileRow
                key={file.path}
                file={file}
                index={idx}
                animate={animateList}
                selected={!isPreview && selectedPath === file.path}
                multiSelect={!isPreview}
                checked={selectedQueuePaths.has(file.path)}
                onSelect={() => onSelectFile(file)}
                onToggleChecked={onToggleQueueSelection ? () => onToggleQueueSelection(file) : undefined}
                onDelete={onDelete}
              />
            ))}
          </div>
          {remainingCount > 0 && (
            <button
              type="button"
              onClick={onOpenWorkbench}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border/50 px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {t.inbox.viewAllFiles(files.length)}
              <ArrowRight size={12} />
            </button>
          )}
        </>
      ) : (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground/70">{t.inbox.queueEmptyTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground/55">{t.inbox.queueEmptyDesc}</p>
        </div>
      )}
    </section>
  );
}

function InboxOrganizationAgentBar({
  files,
  selectedFiles,
  agingCount,
  organizing,
  providerOverride,
  onProviderChange,
  modelOverride,
  onModelChange,
  onSelectAll,
  onSelectAging,
  onClearSelection,
  onOrganize,
}: {
  files: InboxFile[];
  selectedFiles: InboxFile[];
  agingCount: number;
  organizing: boolean;
  providerOverride: ProviderSelection;
  onProviderChange: (provider: ProviderSelection) => void;
  modelOverride: string | null;
  onModelChange: (model: string | null) => void;
  onSelectAll: () => void;
  onSelectAging: () => void;
  onClearSelection: () => void;
  onOrganize: () => void;
}) {
  const { t } = useLocale();
  const selectedCount = selectedFiles.length;
  const disabled = selectedCount === 0 || organizing;

  return (
    <div className="border-b border-border/50 bg-background/55 px-3 py-2.5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">{t.inbox.organizationAgentTitle}</h4>
              <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                {t.inbox.selectedCount(selectedCount)}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/62">
              {selectedCount > 0
                ? t.inbox.organizationAgentReady(selectedCount)
                : t.inbox.organizationAgentDesc}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={files.length === 0}
            className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.inbox.selectAll}
          </button>
          <button
            type="button"
            onClick={onSelectAging}
            disabled={agingCount === 0}
            className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.inbox.selectAging}
          </button>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.inbox.clearSelection}
            </button>
          )}
          <ProviderModelCapsule
            providerValue={providerOverride}
            onProviderChange={onProviderChange}
            modelValue={modelOverride}
            onModelChange={onModelChange}
            disabled={organizing}
            storageKey={INBOX_PROVIDER_MODEL_STORAGE_KEY}
            systemLabel={t.inbox.modelFollowSystem}
            emptyLabel={t.inbox.modelNoProvider}
          />
          <button
            type="button"
            onClick={onOrganize}
            disabled={disabled}
            className="inline-flex min-w-[154px] items-center justify-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-1.5 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {organizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {organizing ? t.inbox.organizing : t.inbox.organizeSelectedAction(selectedCount)}
          </button>
        </div>
      </div>
    </div>
  );
}

function InboxOrganizationPreviewBar({
  files,
  agingCount,
  onOpenWorkbench,
}: {
  files: InboxFile[];
  agingCount: number;
  onOpenWorkbench: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="border-b border-border/50 bg-background/45 px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">{t.inbox.organizationAgentTitle}</h4>
              <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                {t.inbox.fileCount(files.length)}
              </span>
              {agingCount > 0 && (
                <span className="rounded-full bg-[var(--amber)]/10 px-2 py-0.5 text-2xs font-medium text-[var(--amber)]/75">
                  {agingCount} {t.inbox.agingCountLabel}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/62">
              {t.inbox.organizationAgentPreviewDesc}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenWorkbench}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.inbox.reviewPendingAction(files.length)}
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

/* ─── File Row ─── */

function InboxFileRow({
  file,
  onDelete,
  index,
  animate,
  selected,
  multiSelect = false,
  checked = false,
  onSelect,
  onToggleChecked,
}: {
  file: InboxFile;
  onDelete: (name: string) => void;
  index: number;
  animate: boolean;
  selected: boolean;
  multiSelect?: boolean;
  checked?: boolean;
  onSelect: () => void;
  onToggleChecked?: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const ext = getFileExt(file.name);
  const baseName = getFileBaseName(file.name);
  const extStyle = EXT_STYLES[ext];
  const age = formatRelativeTime(file.modifiedAt, t.home.relativeTime);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const sizeLabel = formatSize(file.size);

  const FileIcon = ext === 'csv' ? Table
    : ext === 'json' ? FileCode
    : FileText;
  const iconColor = ext === 'csv' ? 'text-emerald-500/70'
    : ext === 'json' ? 'text-violet-500/70'
    : ext === 'pdf' ? 'text-error/60'
    : 'text-muted-foreground/60';

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        aria-pressed={selected}
        aria-label={file.name}
        className={`group flex items-center gap-3 px-4 py-3 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          selected ? 'bg-[var(--amber-subtle)]/70' : 'bg-card hover:bg-accent'
        }${animate ? ' animate-[fadeSlideUp_0.22s_ease_both]' : ''}`}
        style={animate ? { animationDelay: `${index * 30}ms` } : undefined}
      >
        <span className={`h-8 w-[2px] rounded-full ${selected ? 'bg-[var(--amber)]' : 'bg-transparent'}`} />
        {multiSelect && (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              e.stopPropagation();
              onToggleChecked?.();
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 shrink-0 rounded border-border accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t.inbox.selectItem(file.name)}
          />
        )}
        {/* File icon */}
        {file.source ? (
          <SourceIcon source={file.source} size="md" />
        ) : (
          <FileIcon size={15} className={`shrink-0 ${iconColor}`} />
        )}

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-foreground truncate" title={file.name}>
              {baseName}
            </span>
            {extStyle && (
              <span className={`text-2xs font-mono px-1.5 py-px rounded shrink-0 ${extStyle.bg} ${extStyle.text}`}>
                .{ext}
              </span>
            )}
            {file.isAging && (
              <span className="text-2xs px-1.5 py-px rounded shrink-0 bg-[var(--amber)]/10 text-[var(--amber)]/70" title={t.inbox.agingHint}>
                {t.inbox.agingHint}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {file.source && (
              <>
                <span className="max-w-[180px] truncate rounded-md bg-muted/45 px-1.5 py-px text-2xs text-muted-foreground" title={getInboxSourceLabel(file.source) ?? undefined}>
                  {getInboxSourceLabel(file.source)}
                </span>
                <span className="text-2xs text-muted-foreground/30">·</span>
              </>
            )}
            <span className="text-2xs text-muted-foreground/40 tabular-nums">{sizeLabel}</span>
            <span className="text-2xs text-muted-foreground/30">·</span>
            <span className="text-2xs text-muted-foreground/40 tabular-nums">{age}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); router.push(`/view/${encodePath(file.path)}`); }}
          className={`${selected ? 'hidden md:flex' : 'hidden md:group-hover:flex md:group-focus:flex'} items-center justify-center rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground/55 transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring`}
          title={t.inbox.openFile}
        >
          {t.inbox.openFile}
        </button>

        {/* Hover: delete */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(file.name); }}
          className={`${selected ? 'hidden md:flex' : 'hidden md:group-hover:flex md:group-focus:flex'} items-center justify-center w-7 h-7 rounded-md shrink-0 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring`}
          title={t.inbox.removeFile}
        >
          <X size={14} />
        </button>
      </div>

      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          file={file}
          onDelete={() => { setCtxMenu(null); onDelete(file.name); }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

/* ─── Context Menu ─── */

function FileContextMenu({ x, y, file, onDelete, onClose }: {
  x: number; y: number; file: InboxFile; onDelete: () => void; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  const adjX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 200) : x;
  const adjY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 120) : y;
  const itemCls = 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjY, left: adjX }}
    >
      <button className={itemCls} onClick={() => { router.push(`/view/${encodePath(file.path)}`); onClose(); }}>
        <ExternalLink size={14} className="shrink-0" /> {t.inbox.openFile}
      </button>
      <button className={itemCls} onClick={() => { navigator.clipboard.writeText(file.name); toast.copy(); onClose(); }}>
        <Copy size={14} className="shrink-0" /> {t.inbox.copyName}
      </button>
      <div className="border-t border-border my-1" />
      <button className={`${itemCls} text-destructive hover:text-destructive`} onClick={onDelete}>
        <Trash2 size={14} className="shrink-0" /> {t.inbox.removeFile}
      </button>
    </div>
  );
}

function InboxItemDetailsPanel({
  file,
  understanding,
  onOpen,
  onDelete,
}: {
  file: InboxFile | null;
  understanding: ReturnType<typeof buildUnderstanding> | null;
  onOpen: (file: InboxFile) => void;
  onDelete: (file: InboxFile) => void;
}) {
  const { t } = useLocale();

  if (!file || !understanding) {
    return (
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm">
        <div className="p-8 text-center">
          <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-muted/45 text-muted-foreground/50">
            <Eye size={16} />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground/70">{t.inbox.understandingEmptyTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground/55">{t.inbox.understandingEmptyDesc}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-[var(--amber)]" />
          <h3 className="text-sm font-semibold text-foreground">{t.inbox.itemDetailsTitle}</h3>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
          {t.inbox.itemDetailsDesc}
        </p>
      </div>

      <div className="px-4 py-4">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
          {t.inbox.understandingTitle}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {file.source && <SourceIcon source={file.source} size="sm" />}
          <p className="truncate text-sm font-medium text-foreground" title={file.name}>
            {file.name}
          </p>
        </div>
        {file.source && (
          <p className="mt-1 truncate text-2xs text-muted-foreground/60" title={file.source.url}>
            {getInboxSourceLabel(file.source)} · {file.source.domain ?? file.source.url}
          </p>
        )}
        <p className="mt-1 text-2xs text-muted-foreground/60">
          {formatSize(file.size)} · {formatRelativeTime(file.modifiedAt, t.home.relativeTime)}
        </p>
      </div>

      <div className="border-y border-border/45">
        <ReviewFactRow label={t.inbox.suggestedType} value={understanding.type} />
        <ReviewFactRow label={t.inbox.suggestedTarget} value={understanding.target} />
        <ReviewFactRow label={t.inbox.densityTitle} value={understanding.density} />
      </div>

      <div className="px-4 py-4">
        <div className="rounded-lg bg-muted/30 px-3 py-2.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
            {t.inbox.suggestedReason}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/75">
            {understanding.reason}
          </p>
        </div>

        <p className="mb-2 mt-4 text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
          {t.inbox.relatedSignals}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {understanding.signals.map(signal => (
            <span key={signal} className="rounded-md bg-muted/45 px-2 py-1 text-2xs text-muted-foreground">
              {signal}
            </span>
          ))}
        </div>
      </div>

      <InboxContentPreview key={file.path} file={file} />

      <div className="grid grid-cols-2 gap-2 border-t border-border/45 px-4 py-4">
        <button
          type="button"
          onClick={() => onOpen(file)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.inbox.actionOpen}
        </button>
        <button
          type="button"
          onClick={() => onDelete(file)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.inbox.actionRemove}
        </button>
      </div>
    </section>
  );
}

type PreviewState =
  | { status: 'unsupported' }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'error' };

function InboxContentPreview({ file }: { file: InboxFile }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<PreviewState>(() => (
    isContentPreviewable(file.name) ? { status: 'loading' } : { status: 'unsupported' }
  ));

  useEffect(() => {
    if (!isContentPreviewable(file.name)) {
      return;
    }

    let cancelled = false;
    fetch(`/api/file?path=${encodeURIComponent(file.path)}&op=read_file`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`read failed ${res.status}`);
        const body = await res.json() as { content?: string };
        if (!cancelled) {
          setPreview({ status: 'ready', content: formatContentPreview(body.content ?? '') });
        }
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [file.name, file.path]);

  return (
    <div className="border-t border-border/45 px-4 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
          {t.inbox.contentPreviewTitle}
        </p>
        {isContentPreviewable(file.name) && (
          <span className="text-2xs text-muted-foreground/45">{getFileExt(file.name) || 'text'}</span>
        )}
      </div>
      {preview.status === 'loading' ? (
        <div className="space-y-2 rounded-lg border border-border/45 bg-background/60 p-3">
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ) : preview.status === 'ready' ? (
        preview.content ? (
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg border border-border/45 bg-background/65 p-3 font-mono text-[11px] leading-relaxed text-foreground/78">
            {preview.content}
          </pre>
        ) : (
          <div className="rounded-lg border border-border/45 bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground/55">
            {t.inbox.contentPreviewEmpty}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-border/45 bg-background/60 px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground/55">
          {preview.status === 'unsupported' ? t.inbox.contentPreviewUnavailable : t.inbox.contentPreviewFailed}
        </div>
      )}
    </div>
  );
}

/* ─── History Row ─── */

function HistoryRow({ entry }: { entry: OrganizeHistoryEntry }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const isUndone = entry.status === 'undone';
  const sourceBadge = getSourceBadge(entry.source);
  const duration = entry.durationMs ? formatDuration(entry.durationMs) : null;
  const age = formatRelativeTime(new Date(entry.timestamp).toISOString(), t.home.relativeTime);
  const successCount = entry.files.filter(f => f.ok && !f.undone).length;

  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/20 transition-colors"
      >
        {isUndone ? (
          <AlertCircle size={13} className="text-muted-foreground/40 shrink-0" />
        ) : (
          <Check size={13} className="text-success/70 shrink-0" />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className={`text-xs truncate ${isUndone ? 'text-muted-foreground/50 line-through' : 'text-foreground/80'}`}>
            {entry.sourceFiles.length === 1 ? entry.sourceFiles[0] : t.importHistory.nFiles(entry.sourceFiles.length)}
          </span>
          {sourceBadge && (
            <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${sourceBadge.className}`}>
              {sourceBadge.label}
            </span>
          )}
          {successCount > 0 && (
            <span className="text-2xs text-muted-foreground/40 shrink-0">
              {t.importHistory.changesSummary(successCount)}
            </span>
          )}
        </div>
        <span className="text-2xs text-muted-foreground/40 tabular-nums shrink-0">
          {duration && `${duration} · `}{age}
        </span>
        {entry.files.length > 0 && (
          <ChevronDown
            size={10}
            className={`text-muted-foreground/30 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {expanded && entry.files.length > 0 && (
        <div className="border-t border-border/20 px-3.5 py-2 space-y-0.5">
          {entry.files.map((f, idx) => {
            const parts = f.path.split('/');
            const fileName = parts.pop() ?? f.path;
            const dirPath = parts.length > 0 ? parts.join('/') : null;
            const isClickable = !f.undone && f.ok;
            const rowClass = `flex items-center gap-2 py-1 text-2xs${f.undone ? ' opacity-40' : ''}${isClickable ? ' rounded -mx-1 px-1 hover:bg-muted/20 transition-colors' : ''}`;
            const rowContent = (
              <>
                <span className={`w-1 h-1 rounded-full shrink-0 ${f.ok && !f.undone ? 'bg-success/60' : 'bg-muted-foreground/30'}`} />
                <span className={`truncate flex-1 min-w-0 ${f.undone ? 'line-through text-muted-foreground' : ''}`}>
                  {dirPath && <span className="text-muted-foreground/30">{dirPath}/</span>}
                  <span className={f.undone ? '' : 'text-foreground/70'}>{fileName}</span>
                </span>
                <span className="text-muted-foreground/40 shrink-0">
                  {f.undone ? t.importHistory.statusUndone : f.action === 'create' ? t.importHistory.statusCreated : t.importHistory.statusUpdated}
                </span>
              </>
            );
            return isClickable ? (
              <Link key={`${f.path}-${idx}`} href={`/view/${encodePath(f.path)}`} className={rowClass}>
                {rowContent}
              </Link>
            ) : (
              <div key={`${f.path}-${idx}`} className={rowClass}>
                {rowContent}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─── */

function InboxViewTab({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-[var(--amber)]/45 bg-[var(--amber-subtle)] text-foreground'
          : 'border-border/60 bg-card/50 text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon size={13} className={active ? 'text-[var(--amber)]' : 'text-muted-foreground/55'} />
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="rounded-full bg-background px-1.5 py-px text-2xs text-muted-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

function InboxErrorBanner({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-error/20 bg-error/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle size={15} className="mt-0.5 shrink-0 text-error" />
        <p className="min-w-0 text-xs leading-relaxed text-error">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-error/20 bg-background px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function ReviewFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 border-b border-border/35 px-4 py-2.5 last:border-b-0">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">{label}</p>
      <p className="min-w-0 text-sm font-medium leading-snug text-foreground">{value}</p>
    </div>
  );
}

interface CaptureIntentOption {
  id: CaptureIntent;
  title: string;
  desc: string;
  action: string;
  density: string;
}

function getIntentOptions(labels: InboxUnderstandingLabels): CaptureIntentOption[] {
  return [
    {
      id: 'source',
      title: labels.intentSourceTitle,
      desc: labels.intentSourceDesc,
      action: labels.intentSourceAction,
      density: labels.typeRawNote,
    },
    {
      id: 'note',
      title: labels.intentNoteTitle,
      desc: labels.intentNoteDesc,
      action: labels.intentNoteAction,
      density: labels.typeDocument,
    },
    {
      id: 'judgment',
      title: labels.intentJudgmentTitle,
      desc: labels.intentJudgmentDesc,
      action: labels.intentJudgmentAction,
      density: labels.typeDecision,
    },
    {
      id: 'reflect',
      title: labels.intentReflectTitle,
      desc: labels.intentReflectDesc,
      action: labels.intentReflectAction,
      density: labels.targetDecisions,
    },
  ];
}

function inferSuggestedIntent(
  text: string,
  urls: string[],
  files: File[],
): CaptureIntent {
  const lower = text.toLowerCase();
  const wordCount = countWords(text);
  const fileNames = files.map(file => file.name.toLowerCase()).join(' ');

  if (/decision|rule|preference|principle|judgment|sop|should|must|判断|决策|规则|偏好|原则|方法|以后|不要|必须/.test(lower)) {
    return 'judgment';
  }
  if (/reflect|reflection|why|pattern|blind spot|growth|lesson|复盘|反思|成长|盲区|模式|我发现/.test(lower)) {
    return 'reflect';
  }
  if (urls.length > 0 || wordCount > 80 || /\.(pdf|docx?|md|html?)\b/.test(fileNames)) {
    return 'note';
  }
  return 'source';
}

function inferInboxFileIntent(file: InboxFile): CaptureIntent {
  const lower = file.name.toLowerCase();
  const ext = getFileExt(file.name);
  if (/decision|adr|rule|preference|judgment|判断|决策|规则|偏好/.test(lower)) {
    return 'judgment';
  }
  if (/reflect|reflection|lesson|复盘|反思|成长/.test(lower)) {
    return 'reflect';
  }
  if (looksLikeCapturedArticle(lower) || ['md', 'markdown', 'html', 'htm', 'pdf', 'doc', 'docx', 'docm'].includes(ext)) {
    return 'note';
  }
  return 'source';
}

type InboxUnderstandingLabels = {
  nextActionTitle: string;
  suggestedAction: (action: string) => string;
  intentSourceTitle: string;
  intentSourceDesc: string;
  intentSourceAction: string;
  intentNoteTitle: string;
  intentNoteDesc: string;
  intentNoteAction: string;
  intentJudgmentTitle: string;
  intentJudgmentDesc: string;
  intentJudgmentAction: string;
  intentReflectTitle: string;
  intentReflectDesc: string;
  intentReflectAction: string;
  typeArticle: string;
  typeMeeting: string;
  typeDecision: string;
  typeData: string;
  typeDocument: string;
  typeRawNote: string;
  targetResearch: string;
  targetMeetings: string;
  targetDecisions: string;
  targetData: string;
  targetInboxReview: string;
  reasonArticle: string;
  reasonMeeting: string;
  reasonDecision: string;
  reasonData: string;
  reasonDocument: string;
  reasonRawNote: string;
};

function buildUnderstanding(file: InboxFile, labels: InboxUnderstandingLabels, intent: CaptureIntent): {
  type: string;
  target: string;
  reason: string;
  signals: string[];
  density: string;
} {
  const ext = getFileExt(file.name);
  const lower = file.name.toLowerCase();
  const intentOption = getIntentOptions(labels).find(option => option.id === intent);
  const density = intentOption?.density ?? labels.typeRawNote;
  const signals = [
    ext ? `.${ext}` : 'no extension',
    file.isAging ? 'aged 7+ days' : 'fresh capture',
    intentOption?.title ?? labels.intentSourceTitle,
  ];

  if (file.source || looksLikeCapturedArticle(lower)) {
    return {
      type: labels.typeArticle,
      target: labels.targetResearch,
      reason: labels.reasonArticle,
      signals: [...signals, file.source?.platformLabel ?? file.source?.siteName ?? 'external source'],
      density,
    };
  }
  if (/meeting|interview|访谈|会议|notes?/.test(lower)) {
    return {
      type: labels.typeMeeting,
      target: labels.targetMeetings,
      reason: labels.reasonMeeting,
      signals: [...signals, 'discussion record'],
      density,
    };
  }
  if (/decision|adr|rule|preference|判断|决策|规则|偏好/.test(lower)) {
    return {
      type: labels.typeDecision,
      target: labels.targetDecisions,
      reason: labels.reasonDecision,
      signals: [...signals, 'judgment candidate'],
      density,
    };
  }
  if (ext === 'csv' || ext === 'json' || ext === 'yaml' || ext === 'yml') {
    return {
      type: labels.typeData,
      target: labels.targetData,
      reason: labels.reasonData,
      signals: [...signals, 'structured'],
      density,
    };
  }
  if (ext === 'pdf' || ext === 'docx' || ext === 'doc' || ext === 'docm') {
    return {
      type: labels.typeDocument,
      target: labels.targetResearch,
      reason: labels.reasonDocument,
      signals: [...signals, 'long-form'],
      density,
    };
  }
  return {
    type: labels.typeRawNote,
    target: labels.targetInboxReview,
    reason: labels.reasonRawNote,
    signals,
    density,
  };
}

function looksLikeCapturedArticle(lowerName: string): boolean {
  return /article|url|web|clip|wechat|公众号|mp.weixin|小红书|link|reference|ref/.test(lowerName);
}

function isContentPreviewable(name: string): boolean {
  const ext = getFileExt(name);
  return ['', 'md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm'].includes(ext);
}

function formatContentPreview(content: string): string {
  const withoutYamlFrontmatter = content.replace(/^\uFEFF?---[ \t]*(?:\r?\n)[\s\S]*?(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/, '');
  const withoutCaptureHeader = stripGeneratedCaptureHeader(withoutYamlFrontmatter);
  const compact = withoutCaptureHeader.trim();
  const limit = 3200;
  return compact.length > limit ? `${compact.slice(0, limit).trimEnd()}\n...` : compact;
}

function stripGeneratedCaptureHeader(content: string): string {
  const lines = content.split(/\r?\n/);
  const headerStart = lines.findIndex(line => line.trim().length > 0);
  if (headerStart < 0 || lines[headerStart]?.trim() !== '***') return content;

  const separatorIndex = lines.findIndex((line, index) => index > headerStart && /^[-*_]{6,}$/.test(line.trim()));
  if (separatorIndex < headerStart + 2 || separatorIndex - headerStart > 24) return content;

  const headerLines = lines.slice(headerStart + 1, separatorIndex);
  const hasCaptureMetadata = headerLines.some(line => /^(title|source|url|author|site|platform|clipped):/i.test(line.trim()));
  return hasCaptureMetadata ? lines.slice(separatorIndex + 1).join('\n') : content;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const cjk = trimmed.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = trimmed
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + words;
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    const label = `${parsed.hostname}${path}`;
    return label.length > 42 ? `${label.slice(0, 39)}...` : label;
  } catch {
    return url.length > 42 ? `${url.slice(0, 39)}...` : url;
  }
}

function removeSavedPendingFiles(files: File[], savedOriginalNames: string[]): File[] {
  const remainingSavedByName = new Map<string, number>();
  for (const name of savedOriginalNames) {
    remainingSavedByName.set(name, (remainingSavedByName.get(name) ?? 0) + 1);
  }
  return files.filter(file => {
    const remaining = remainingSavedByName.get(file.name) ?? 0;
    if (remaining <= 0) return true;
    remainingSavedByName.set(file.name, remaining - 1);
    return false;
  });
}

function buildCaptureFileName(content: string, intent: CaptureIntent): string {
  const firstLine = content.split(/\r?\n/).find(line => line.trim())?.trim() ?? 'capture';
  const clean = firstLine
    .replace(/^#+\s*/, '')
    .replace(/[`*_~[\]()#>]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `capture-${intent}-${timestamp}-${clean || 'note'}.md`;
}

function getSourceBadge(source?: OrganizeSource): { label: string; className: string } | null {
  switch (source) {
    case 'drag-drop':      return { label: 'drop',   className: 'bg-muted/50 text-muted-foreground/50' };
    case 'inbox-organize': return { label: 'inbox',  className: 'bg-[var(--amber)]/10 text-[var(--amber)]/70' };
    case 'import-modal':   return { label: 'import', className: 'bg-blue-500/10 text-blue-500/70' };
    case 'plugin':         return { label: 'plugin', className: 'bg-violet-500/10 text-violet-500/70' };
    case 'upload':         return { label: 'upload', className: 'bg-teal-500/10 text-teal-500/70' };
    case 'web-clipper':    return { label: 'clip',   className: 'bg-emerald-500/10 text-emerald-500/70' };
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
