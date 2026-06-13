'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Inbox,
  Sparkles,
  FileText,
  AlertCircle,
  Loader2,
  Upload,
  FolderInput,
  Check,
  X,
  ArrowLeft,
  History,
  ListChecks,
  Archive,
  ArrowRight,
  Paperclip,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { quickDropToInbox, clipUrlToInbox, looksLikeUrl, extractUrlFromDrop, dragContainsUrl } from '@/lib/inbox-upload';
import { loadHistory, type OrganizeHistoryEntry } from '@/lib/organize-history';
import { CAPTURE_ACCEPT } from '@/lib/capture-formats';
import ProviderModelCapsule, { getPersistedProviderModel, type ProviderSelection } from '@/components/ask/ProviderModelCapsule';
import { useInboxOrganize } from '@/components/inbox/InboxOrganizeContext';
import { SourceIcon, getInboxSourceLabel } from '@/components/inbox/SourceIcon';
import { archiveInboxFiles, fetchInboxFiles, saveInboxFiles } from '@/lib/inbox-client';
import { isAnyPathUnder, subscribeFilesChanged } from '@/lib/files-changed';
import {
  INBOX_SHELVED_STORAGE_KEY,
  INBOX_SHELVED_UPDATED_EVENT,
  addShelvedInboxPaths,
  normalizeShelvedInboxPaths,
  readShelvedInboxPaths,
  removeShelvedInboxPaths,
  writeShelvedInboxPaths,
} from '@/lib/inbox-shelved';
import type {
  CaptureIntent,
  CaptureSaveOutcome,
  InboxFile,
  InboxViewMode,
  LastSavedSummary,
} from '@/components/inbox/InboxViewTypes';
import {
  buildCaptureFileName,
  countWords,
  formatSize,
  getFileExt,
  getUrlHost,
  removeSavedPendingFiles,
  shortenUrl,
} from '@/components/inbox/InboxViewFormat';
import {
  dispatchSyntheticHashChange,
  getInboxHashState,
  getInitialInboxViewMode,
  getInitialSelectedInboxPath,
} from '@/components/inbox/InboxViewRouting';
import {
  buildUnderstanding,
  getIntentOptions,
  inferInboxFileIntent,
  inferSuggestedIntent,
} from '@/components/inbox/InboxViewModel';
import { InboxErrorBanner, InboxItemDetailsPanel, InboxProcessNav, HistoryRow } from '@/components/inbox/InboxViewDetails';
import { InboxFileRow } from '@/components/inbox/InboxFileRow';
import { ContentPageShell } from '@/components/shared/ContentPageShell';

const HISTORY_VISIBLE = 5;
const REVIEW_PREVIEW_VISIBLE = 5;
const INBOX_PROVIDER_MODEL_STORAGE_KEY = 'mindos-inbox-provider-model';

type StagedTextNote = {
  id: string;
  content: string;
  wordCount: number;
  createdAt: string;
};

function shouldCapturePastedUrl({
  currentValue,
  selectionStart,
  selectionEnd,
}: {
  currentValue: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}): boolean {
  const trimmedCurrent = currentValue.trim();
  if (trimmedCurrent.length === 0) return true;
  if (looksLikeUrl(trimmedCurrent)) return true;

  const hasFullSelection = selectionStart === 0 && selectionEnd === currentValue.length;
  return hasFullSelection;
}

function createStagedTextNote(content: string): StagedTextNote {
  const fallbackId = `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const id = globalThis.crypto?.randomUUID?.() ?? fallbackId;
  return {
    id,
    content,
    wordCount: countWords(content),
    createdAt: new Date().toISOString(),
  };
}

function takeCount(map: Map<string, number>, key: string): boolean {
  const count = map.get(key) ?? 0;
  if (count <= 0) return false;
  if (count === 1) {
    map.delete(key);
  } else {
    map.set(key, count - 1);
  }
  return true;
}

export default function InboxView() {
  const { t } = useLocale();
  const router = useRouter();
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<OrganizeHistoryEntry[]>([]);
  const [draftText, setDraftText] = useState('');
  const [stagedNotes, setStagedNotes] = useState<StagedTextNote[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [savingText, setSavingText] = useState(false);
  const [savingToMind, setSavingToMind] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(() => getInitialSelectedInboxPath());
  const [selectedQueuePaths, setSelectedQueuePaths] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<InboxViewMode>(() => getInitialInboxViewMode());
  const [lastSavedSummary, setLastSavedSummary] = useState<LastSavedSummary | null>(null);
  const [shelvedPaths, setShelvedPaths] = useState<string[]>(() => readShelvedInboxPaths());
  const [providerOverride, setProviderOverride] = useState<ProviderSelection>(
    () => getPersistedProviderModel(INBOX_PROVIDER_MODEL_STORAGE_KEY).provider,
  );
  const [modelOverride, setModelOverride] = useState<string | null>(
    () => getPersistedProviderModel(INBOX_PROVIDER_MODEL_STORAGE_KEY).model,
  );
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
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
      return nextFiles;
    } catch (err) {
      console.warn('[InboxView] fetch failed:', err);
      setInboxError(err instanceof Error ? err.message : t.inbox.loadFailed);
      return null;
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

    // Coalesced files-changed subscription: skip the refetch entirely when the
    // event declares paths and none of them touch the Inbox directory.
    const unsubscribeFilesChanged = subscribeFilesChanged(
      () => debouncedRefresh(),
      { isRelevant: (paths) => isAnyPathUnder(paths, 'Inbox') },
    );
    window.addEventListener('mindos:inbox-updated', debouncedRefresh);
    window.addEventListener('mindos:organize-done', onOrganizeDone);
    window.addEventListener('mindos:organize-history-update', refreshHistory);
    window.addEventListener('drop', resetDrag, true);
    window.addEventListener('dragend', resetDrag, true);
    return () => {
      cancelled = true;
      clearTimeout(refreshTimerRef.current);
      unsubscribeFilesChanged();
      window.removeEventListener('mindos:inbox-updated', debouncedRefresh);
      window.removeEventListener('mindos:organize-done', onOrganizeDone);
      window.removeEventListener('mindos:organize-history-update', refreshHistory);
      window.removeEventListener('drop', resetDrag, true);
      window.removeEventListener('dragend', resetDrag, true);
    };
  }, [fetchInbox, debouncedRefresh, refreshHistory]);

  useEffect(() => {
    const syncShelvedPaths = () => setShelvedPaths(readShelvedInboxPaths());
    const syncStorage = (event: StorageEvent) => {
      if (event.key === INBOX_SHELVED_STORAGE_KEY) syncShelvedPaths();
    };
    window.addEventListener(INBOX_SHELVED_UPDATED_EVENT, syncShelvedPaths);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(INBOX_SHELVED_UPDATED_EVENT, syncShelvedPaths);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

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

  const stageCurrentNote = useCallback(() => {
    const content = draftText.trim();
    if (!content || savingText || savingToMind) return false;
    setStagedNotes(prev => [...prev, createStagedTextNote(content)]);
    setDraftText('');
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
    return true;
  }, [draftText, savingText, savingToMind]);

  const savePendingCaptures = useCallback(async (captureIntent: CaptureIntent): Promise<CaptureSaveOutcome> => {
    const draftContent = draftText.trim();
    const draftCapture = draftContent
      ? { ...createStagedTextNote(draftContent), id: '__draft__' }
      : null;
    const textCaptures = [
      ...stagedNotes,
      ...(draftCapture ? [draftCapture] : []),
    ].map(note => ({
      ...note,
      name: buildCaptureFileName(note.content, captureIntent),
    }));
    let savedAny = false;
    let savedCount = 0;
    let failedCount = 0;
    let textSaveFailed = false;
    let latestFiles: InboxFile[] | null = null;

    if (textCaptures.length > 0) {
      try {
        const result = await saveInboxFiles(
          textCaptures.map(note => ({ name: note.name, content: note.content, encoding: 'text' })),
          t.inbox.saveFailed,
          { source: 'text', captureIntent },
        );
        const savedTextIds = new Set<string>();
        if (result.saved.length === textCaptures.length && result.skipped.length === 0) {
          for (const note of textCaptures) {
            savedTextIds.add(note.id);
          }
        } else {
          const savedByName = new Map<string, number>();
          for (const item of result.saved) {
            savedByName.set(item.original, (savedByName.get(item.original) ?? 0) + 1);
          }

          for (const note of textCaptures) {
            if (takeCount(savedByName, note.name)) {
              savedTextIds.add(note.id);
            }
          }
        }

        if (savedTextIds.size > 0) {
          savedAny = true;
          savedCount += savedTextIds.size;
          setStagedNotes(prev => prev.filter(note => !savedTextIds.has(note.id)));
          if (draftCapture && savedTextIds.has(draftCapture.id)) setDraftText('');
        }

        const failedTextCount = textCaptures.length - savedTextIds.size;
        if (failedTextCount > 0) {
          failedCount += failedTextCount;
          textSaveFailed = true;
        }
      } catch {
        failedCount += textCaptures.length;
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
      latestFiles = await fetchInbox();
      window.dispatchEvent(new Event('mindos:inbox-updated'));
    }

    return { savedAny, savedCount, failedCount, textSaveFailed, latestFiles };
  }, [draftText, fetchInbox, pendingFiles, pendingUrls, stagedNotes, t]);

  const handleCapture = useCallback(async () => {
    const content = draftText.trim();
    if ((stagedNotes.length === 0 && !content && pendingFiles.length === 0 && pendingUrls.length === 0) || savingText || savingToMind) return;
    setSavingText(true);
    try {
      const captureIntent = inferSuggestedIntent(
        [draftText, ...stagedNotes.map(note => note.content)].filter(Boolean).join('\n\n'),
        pendingUrls,
        pendingFiles,
      );
      const outcome = await savePendingCaptures(captureIntent);
      if (content && stagedNotes.length === 0 && !outcome.textSaveFailed && pendingUrls.length === 0 && pendingFiles.length === 0) {
        toast.success(t.inbox.textSaved, 3000);
      }
      if (outcome.textSaveFailed) {
        toast.error(outcome.savedAny ? t.inbox.capturePartialFailed : t.inbox.saveFailed, 4000);
      }
    } catch {
      toast.error(t.inbox.saveFailed, 4000);
    } finally {
      setSavingText(false);
    }
  }, [draftText, pendingFiles, pendingUrls, savePendingCaptures, savingText, savingToMind, stagedNotes, t]);

  const handleComposerPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      addPendingFiles(files);
      return;
    }
    const pasted = e.clipboardData.getData('text/plain').trim();
    if (pasted && looksLikeUrl(pasted) && shouldCapturePastedUrl({
      currentValue: e.currentTarget.value,
      selectionStart: e.currentTarget.selectionStart,
      selectionEnd: e.currentTarget.selectionEnd,
    })) {
      e.preventDefault();
      addPendingUrl(pasted);
    }
  }, [addPendingFiles, addPendingUrl]);

  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      stageCurrentNote();
    }
  }, [stageCurrentNote]);

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

  useEffect(() => {
    if (loading || inboxError) return;
    const validPaths = new Set(files.map(file => file.path));
    const normalized = normalizeShelvedInboxPaths(shelvedPaths, validPaths);
    if (normalized.length !== shelvedPaths.length || normalized.some((path, index) => path !== shelvedPaths[index])) {
      writeShelvedInboxPaths(normalized);
    }
  }, [files, inboxError, loading, shelvedPaths]);

  const shelvedPathSet = useMemo(() => new Set(shelvedPaths), [shelvedPaths]);
  const queueFiles = useMemo(() => files.filter(file => !shelvedPathSet.has(file.path)), [files, shelvedPathSet]);
  const shelvedFiles = useMemo(() => files.filter(file => shelvedPathSet.has(file.path)), [files, shelvedPathSet]);
  const selectedQueuePathSet = useMemo(() => new Set(selectedQueuePaths), [selectedQueuePaths]);
  const selectedQueueFiles = useMemo(
    () => queueFiles.filter(file => selectedQueuePathSet.has(file.path)),
    [queueFiles, selectedQueuePathSet],
  );
  const selectedFile = useMemo(
    () => {
      const visibleFiles = activeView === 'shelved'
        ? shelvedFiles
        : activeView === 'queue'
          ? queueFiles
          : files;
      return visibleFiles.find(f => f.path === selectedPath) ?? null;
    },
    [activeView, files, queueFiles, selectedPath, shelvedFiles],
  );
  const selectedUnderstanding = useMemo(
    () => selectedFile ? buildUnderstanding(selectedFile, t.inbox, inferInboxFileIntent(selectedFile)) : null,
    [selectedFile, t],
  );
  const intentOptions = useMemo(() => getIntentOptions(t.inbox), [t]);
  const captureTextForIntent = useMemo(
    () => [draftText.trim(), ...stagedNotes.map(note => note.content)].filter(Boolean).join('\n\n'),
    [draftText, stagedNotes],
  );
  const suggestedIntent = useMemo(
    () => inferSuggestedIntent(captureTextForIntent, pendingUrls, pendingFiles),
    [captureTextForIntent, pendingUrls, pendingFiles],
  );
  const suggestedIntentOption = intentOptions.find(intent => intent.id === suggestedIntent) ?? intentOptions[0];
  const hasCurrentDraft = draftText.trim().length > 0;
  const stagedCaptureCount = stagedNotes.length + pendingUrls.length + pendingFiles.length;
  const saveCaptureCount = stagedCaptureCount + (hasCurrentDraft ? 1 : 0);
  const hasPendingCapture = hasCurrentDraft || stagedCaptureCount > 0;
  const canOrganizeToMind = hasPendingCapture || queueFiles.length > 0;
  const textWordCount = countWords(draftText);
  const visibleHistory = useMemo(() => history.slice(0, HISTORY_VISIBLE), [history]);
  const [animateList, setAnimateList] = useState(true);
  const prevFileCountRef = useRef(0);
  useEffect(() => {
    if (prevFileCountRef.current > 0 && queueFiles.length > 0) setAnimateList(false);
    prevFileCountRef.current = queueFiles.length;
  }, [queueFiles.length]);

  useEffect(() => {
    const syncHash = () => {
      const next = getInboxHashState();
      setActiveView(next.view);
      if (next.selectedPath) setSelectedPath(next.selectedPath);
    };
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const switchView = useCallback((view: InboxViewMode, selectedPathForView?: string) => {
    setActiveView(view);
    if (typeof window === 'undefined') return;
    const oldUrl = window.location.href;
    const baseUrl = `${window.location.pathname}${window.location.search}`;
    const selectedPathHash = selectedPathForView ? `?path=${encodeURIComponent(selectedPathForView)}` : '';
    const nextUrl = view === 'capture'
      ? baseUrl
      : `${baseUrl}#${view}${view === 'queue' ? selectedPathHash : ''}`;
    window.history.replaceState(null, '', nextUrl);
    dispatchSyntheticHashChange(oldUrl, window.location.href);
  }, []);
  const openQueueWorkbench = useCallback((path?: string) => {
    if (path) setSelectedPath(path);
    switchView('queue', path);
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
      : activeView === 'shelved'
        ? t.inbox.shelvedPageTitle
      : t.inbox.donePageTitle;
  const pageSubtitle = activeView === 'capture'
    ? t.inbox.capturePageSubtitle
    : activeView === 'queue'
      ? ''
      : activeView === 'shelved'
        ? t.inbox.shelvedPageSubtitle
      : t.inbox.donePageSubtitle;
  const toggleQueueSelection = useCallback((file: InboxFile) => {
    setSelectedQueuePaths(prev => (
      prev.includes(file.path)
        ? prev.filter(path => path !== file.path)
        : [...prev, file.path]
    ));
  }, []);

  const selectAllQueueFiles = useCallback(() => {
    setSelectedQueuePaths(prev => {
      const queuePaths = queueFiles.map(file => file.path);
      if (queuePaths.length > 0 && queuePaths.every(path => prev.includes(path))) {
        return [];
      }
      return queuePaths;
    });
  }, [queueFiles]);

  const clearQueueSelection = useCallback(() => {
    setSelectedQueuePaths([]);
  }, []);

  const shelveFiles = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const next = addShelvedInboxPaths(shelvedPaths, paths);
    setShelvedPaths(next);
    setSelectedQueuePaths(prev => prev.filter(path => !paths.includes(path)));
    setSelectedPath(prev => (prev && paths.includes(prev) ? null : prev));
    toast.success(t.inbox.fileShelved);
  }, [shelvedPaths, t.inbox.fileShelved]);

  const restoreFiles = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const next = removeShelvedInboxPaths(shelvedPaths, paths);
    setShelvedPaths(next);
    setSelectedPath(prev => (prev && paths.includes(prev) ? null : prev));
    toast.success(t.inbox.fileRestored);
  }, [shelvedPaths, t.inbox.fileRestored]);

  const shelveSelectedQueueFiles = useCallback(() => {
    shelveFiles(selectedQueueFiles.map(file => file.path));
  }, [selectedQueueFiles, shelveFiles]);

  const handleOrganizeToMind = useCallback(async () => {
    const hasStagedInput = stagedNotes.length > 0 || draftText.trim().length > 0 || pendingFiles.length > 0 || pendingUrls.length > 0;
    if ((!hasStagedInput && queueFiles.length === 0) || savingText || savingToMind || organizing) return;

    setSavingToMind(true);
    try {
      let filesForRun = queueFiles;
      let outcome: CaptureSaveOutcome | null = null;

      if (hasStagedInput) {
        const captureIntent = inferSuggestedIntent(
          [draftText.trim(), ...stagedNotes.map(note => note.content)].filter(Boolean).join('\n\n'),
          pendingUrls,
          pendingFiles,
        );
        outcome = await savePendingCaptures(captureIntent);
        const latestFiles = outcome.latestFiles ?? files;
        filesForRun = latestFiles.filter(file => !shelvedPathSet.has(file.path));
      }

      if (outcome?.textSaveFailed) {
        toast.error(outcome.savedAny ? t.inbox.capturePartialFailed : t.inbox.saveFailed, 4000);
      }

      if (filesForRun.length === 0) {
        toast.error(t.inbox.organizeToMindEmpty, 3000);
        return;
      }

      setSelectedQueuePaths(filesForRun.map(file => file.path));
      switchView('queue');
      await inboxOrganize.requestInboxOrganize(filesForRun, {
        providerOverride,
        modelOverride,
      });
    } catch {
      toast.error(t.inbox.saveFailed, 4000);
    } finally {
      setSavingToMind(false);
    }
  }, [
    draftText,
    files,
    inboxOrganize,
    modelOverride,
    organizing,
    pendingFiles,
    pendingUrls,
    providerOverride,
    queueFiles,
    savePendingCaptures,
    savingText,
    savingToMind,
    shelvedPathSet,
    stagedNotes,
    switchView,
    t,
  ]);

  if (loading) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-var(--app-titlebar-h))]">
        <div className="flex-1">
          <ContentPageShell className="inbox-content-page space-y-5" data-content-page-shell="inbox">
            <div className="max-w-2xl space-y-2">
              <div className="h-7 w-40 rounded bg-muted/55 animate-pulse" />
              <div className="h-4 w-64 rounded bg-muted/40 animate-pulse" />
            </div>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-muted/40 rounded-lg animate-pulse" />
            ))}
          </ContentPageShell>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-var(--app-titlebar-h))]">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={CAPTURE_ACCEPT}
        className="hidden"
        onChange={(e) => addPendingFiles(e.target.files)}
      />

      <div className="flex-1">
        <ContentPageShell className="inbox-content-page space-y-5" data-content-page-shell="inbox">
          <InboxPageHeader
            activeView={activeView}
            title={pageTitle}
            subtitle={pageSubtitle}
            backLabel={t.inbox.viewCapture}
            uploadLabel={t.inbox.uploadButton}
            onBack={() => switchView('capture')}
            onUpload={() => fileInputRef.current?.click()}
          />

          <InboxProcessNav
            activeView={activeView}
            pendingCount={queueFiles.length}
            shelvedCount={shelvedFiles.length}
            doneCount={history.length}
            onSwitch={switchView}
          />

          {activeView === 'capture' && (
            <InboxCaptureFlowSteps
              onReview={() => openQueueWorkbench()}
            />
          )}

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

          <div
            className={
              activeView === 'queue'
                ? 'grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_350px] 2xl:grid-cols-[minmax(0,1.08fr)_380px]'
                : activeView === 'shelved'
                  ? 'grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_350px] 2xl:grid-cols-[minmax(0,1.08fr)_380px]'
                  : activeView === 'capture'
                    ? 'grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] xl:items-stretch'
                    : 'max-w-[760px]'
            }
            data-inbox-main-layout
          >
            <div className={`min-w-0 space-y-5 ${activeView === 'capture' ? 'h-full' : ''}`}>
              {activeView === 'capture' && (
                <>
                  <div
                    className={`h-full rounded-xl transition-all duration-200 ${
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
                      className={`flex h-full min-h-[380px] flex-col overflow-hidden rounded-xl border shadow-sm transition-colors ${
                        dragOver
                          ? 'border-[var(--amber)] bg-[var(--amber-subtle)]'
                          : 'border-border/60 bg-card/75'
                      }`}
                      data-inbox-composer-card
                    >
                      <div className="border-b border-border/45 px-4 py-3.5">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
                              <FolderInput size={14} />
                            </span>
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-foreground">{t.inbox.composerTitle}</span>
                              <p
                                className="mt-1 text-xs leading-relaxed text-muted-foreground/60"
                                data-capture-autodetect-hint
                              >
                                {t.inbox.captureAutoDetectHint}
                              </p>
                            </div>
                          </div>
                          {saveCaptureCount > 0 && (
                            <span className="shrink-0 rounded-lg bg-muted/45 px-2 py-1 text-2xs font-medium text-muted-foreground">
                              {t.inbox.captureSessionCount(saveCaptureCount)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col px-4 py-4">
                        <div
                          className={`flex min-h-[180px] flex-1 flex-col rounded-xl border transition-colors ${
                            dragOver
                              ? 'border-[var(--amber)] bg-background/65'
                              : 'border-dashed border-border/60 bg-background/45'
                          }`}
                        >
                          <textarea
                            ref={composerInputRef}
                            value={draftText}
                            onChange={(e) => setDraftText(e.target.value)}
                            onKeyDown={handleComposerKeyDown}
                            onPaste={handleComposerPaste}
                            aria-label={t.inbox.composerInputLabel}
                            placeholder={t.inbox.composerPlaceholder}
                            className="min-h-[140px] flex-1 resize-y bg-transparent px-4 py-4 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
                          />
                          <div
                            className="flex flex-wrap items-center justify-between gap-2 border-t border-border/35 px-4 py-2.5"
                            data-inbox-composer-footer
                          >
                            <span className="text-2xs text-muted-foreground/55">
                              {hasCurrentDraft
                                ? t.inbox.currentDraftHint(textWordCount)
                                : t.inbox.captureDropHint}
                            </span>
                            <button
                              type="button"
                              onClick={stageCurrentNote}
                              disabled={!hasCurrentDraft || savingText || savingToMind}
                              className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-[var(--amber)]/35 hover:bg-[var(--amber-subtle)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                              data-stage-note-action
                            >
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-[var(--amber-subtle)] text-[var(--amber)]">
                                <FileText size={10} />
                              </span>
                              {t.inbox.stageNoteAction}
                              <span className="rounded bg-muted/55 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/65">
                                {t.inbox.stageNoteShortcut}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {stagedCaptureCount > 0 && (
                        <div className="border-t border-border/40 px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/55">
                              {t.inbox.stagedCapturesTitle}
                            </p>
                            <span className="rounded-md bg-muted/45 px-1.5 py-0.5 text-2xs text-muted-foreground">
                              {t.inbox.stagedCaptureCount(stagedCaptureCount)}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {stagedNotes.map(note => (
                              <PendingCaptureRow
                                key={note.id}
                                icon={<FileText size={12} />}
                                label={t.inbox.pendingNote}
                                detail={t.inbox.pendingText(note.wordCount)}
                                onRemove={() => setStagedNotes(prev => prev.filter(item => item.id !== note.id))}
                              />
                            ))}
                            {pendingUrls.map(url => (
                              <PendingCaptureRow
                                key={url}
                                icon={<SourceIcon url={url} size="xs" className="border-0 shadow-none" />}
                                label={t.inbox.pendingUrl}
                                detail={shortenUrl(url)}
                                onRemove={() => setPendingUrls(prev => prev.filter(item => item !== url))}
                              />
                            ))}
                            {pendingFiles.map(file => (
                              <PendingCaptureRow
                                key={`${file.name}:${file.size}:${file.lastModified}`}
                                icon={<Paperclip size={12} />}
                                label={t.inbox.pendingFile}
                                detail={`${file.name} · ${formatSize(file.size)}`}
                                onRemove={() => setPendingFiles(prev => prev.filter(item => item !== file))}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 border-t border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                            data-inbox-attach-action
                          >
                            <Paperclip size={13} />
                            {t.inbox.attachButton}
                          </button>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2" data-inbox-primary-actions>
                          {hasPendingCapture && (
                            <button
                              type="button"
                              onClick={() => {
                                setDraftText('');
                                setStagedNotes([]);
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
                            onClick={handleCapture}
                            disabled={!hasPendingCapture || savingText || savingToMind}
                            className="flex items-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-2 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {savingText ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                            {savingText
                              ? (saveCaptureCount > 1 ? t.inbox.savingItems(saveCaptureCount) : t.inbox.savingText)
                              : (saveCaptureCount > 1 ? t.inbox.captureButtonCount(saveCaptureCount) : t.inbox.captureButton)}
                          </button>
                          <button
                            type="button"
                            onClick={handleOrganizeToMind}
                            disabled={!canOrganizeToMind || savingText || savingToMind || organizing}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--amber)]/35 bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-[var(--amber-subtle)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {savingToMind || organizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-[var(--amber)]" />}
                            {savingToMind || organizing ? t.inbox.organizeToMindRunning : t.inbox.organizeToMindAction}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {lastSavedSummary && (
                    <InboxLastSavedStrip
                      summary={lastSavedSummary}
                      pendingCount={queueFiles.length}
                      onReview={scrollToReviewPreview}
                      onDismiss={() => setLastSavedSummary(null)}
                    />
                  )}
                </>
              )}

              {activeView === 'queue' && (
                <InboxQueueSection
                  variant="workbench"
                  files={queueFiles}
                  inboxError={inboxError}
                  animateList={animateList}
                  selectedPath={selectedPath}
                  selectedQueuePaths={selectedQueuePathSet}
                  selectedQueueFiles={selectedQueueFiles}
                  onSelectFile={(file) => setSelectedPath(file.path)}
                  onToggleQueueSelection={toggleQueueSelection}
                  onSelectAll={selectAllQueueFiles}
                  onClearSelection={clearQueueSelection}
                  onOrganizeSelected={handleOrganizeSelected}
                  onShelveSelected={shelveSelectedQueueFiles}
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

              {activeView === 'shelved' && (
                <InboxShelvedSection
                  files={shelvedFiles}
                  inboxError={inboxError}
                  animateList={animateList}
                  selectedPath={selectedPath}
                  onSelectFile={(file) => setSelectedPath(file.path)}
                  onRestore={(file) => restoreFiles([file.path])}
                  onDelete={handleDeleteFile}
                  onRetry={() => {
                    setLoading(true);
                    void fetchInbox();
                  }}
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
              <aside className="min-w-0 xl:self-stretch">
                <InboxCapturePreviewPanel
                  draftText={draftText}
                  stagedNotes={stagedNotes}
                  pendingUrls={pendingUrls}
                  pendingFiles={pendingFiles}
                  selectedIntentTitle={suggestedIntentOption.title}
                  textWordCount={textWordCount}
                  saveCaptureCount={saveCaptureCount}
                />
              </aside>
            )}

            {activeView === 'capture' && (
              <div className="min-w-0 xl:col-span-2">
                <InboxQueueSection
                  sectionRef={reviewSectionRef}
                  variant="preview"
                  files={queueFiles}
                  inboxError={inboxError}
                  animateList={animateList}
                  selectedPath={selectedPath}
                  selectedQueuePaths={selectedQueuePathSet}
                  selectedQueueFiles={selectedQueueFiles}
                  onSelectFile={(file) => openQueueWorkbench(file.path)}
                  onToggleQueueSelection={toggleQueueSelection}
                  onSelectAll={selectAllQueueFiles}
                  onClearSelection={clearQueueSelection}
                  onOrganizeSelected={handleOrganizeSelected}
                  onShelveSelected={shelveSelectedQueueFiles}
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
              <aside className="lg:sticky lg:top-[calc(var(--app-titlebar-h)+24px)] lg:self-start">
                <InboxItemDetailsPanel
                  file={selectedFile}
                  understanding={selectedUnderstanding}
                  onOpen={(file) => router.push(`/view/${encodePath(file.path)}`)}
                  onShelve={(file) => shelveFiles([file.path])}
                  onDelete={(file) => handleDeleteFile(file.name)}
                />
              </aside>
            )}

            {activeView === 'shelved' && (
              <aside className="lg:sticky lg:top-[calc(var(--app-titlebar-h)+24px)] lg:self-start">
                <InboxItemDetailsPanel
                  file={selectedFile}
                  understanding={selectedUnderstanding}
                  mode="shelved"
                  onOpen={(file) => router.push(`/view/${encodePath(file.path)}`)}
                  onRestore={(file) => restoreFiles([file.path])}
                  onDelete={(file) => handleDeleteFile(file.name)}
                />
              </aside>
            )}
          </div>
        </ContentPageShell>
      </div>
    </div>
  );
}

function InboxPageHeader({
  activeView,
  title,
  subtitle,
  backLabel,
  uploadLabel,
  onBack,
  onUpload,
}: {
  activeView: InboxViewMode;
  title: string;
  subtitle: string;
  backLabel: string;
  uploadLabel: string;
  onBack: () => void;
  onUpload: () => void;
}) {
  const isCaptureView = activeView === 'capture';

  return (
    <header
      className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      data-inbox-page-header
    >
      <div className="min-w-0">
        {!isCaptureView && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            data-inbox-back-to-capture
          >
            <ArrowLeft size={13} />
            {backLabel}
          </button>
        )}
        <h1
          className={`${isCaptureView ? '' : 'mt-2'} text-2xl font-semibold leading-tight text-foreground`}
          data-inbox-page-title
        >
          {title}
        </h1>
        {subtitle.trim().length > 0 && (
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      {!isCaptureView && (
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={uploadLabel}
          data-inbox-page-upload
        >
          <Upload size={13} />
          {uploadLabel}
        </button>
      )}
    </header>
  );
}

function InboxCaptureFlowSteps({ onReview }: { onReview: () => void }) {
  const { t } = useLocale();
  const steps = [
    {
      number: '1',
      title: t.inbox.capturePageTitle,
      active: true,
      onClick: undefined,
    },
    {
      number: '2',
      title: t.inbox.queueTitle,
      active: false,
      onClick: onReview,
    },
    {
      number: '3',
      title: t.inbox.organizeToMindAction,
      active: false,
      onClick: onReview,
    },
  ];

  return (
    <nav
      aria-label={t.inbox.title}
      className="hidden items-center gap-0 text-xs md:flex"
      data-inbox-flow-steps
    >
      {steps.map((step, index) => {
        const content = (
          <>
            <span
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-2xs font-semibold ${
                step.active
                  ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--amber-foreground)]'
                  : 'border-border/70 bg-background text-muted-foreground/70'
              }`}
            >
              {step.number}
            </span>
            <span className={`truncate font-medium ${step.active ? 'text-foreground' : 'text-muted-foreground/72'}`}>
              {step.title}
            </span>
          </>
        );

        return (
          <div key={step.number} className="flex min-w-0 items-center">
            {step.onClick ? (
            <button
              type="button"
              onClick={step.onClick}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {content}
            </button>
            ) : (
              <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5">
                {content}
              </div>
            )}
            {index < steps.length - 1 && (
              <span className="mx-2 h-px w-8 shrink-0 bg-border/70 lg:w-12" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ─── Capture Confirmation + Queue ─── */

function PendingCaptureRow({
  icon,
  label,
  detail,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
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
  stagedNotes,
  pendingUrls,
  pendingFiles,
  selectedIntentTitle,
  textWordCount,
  saveCaptureCount,
}: {
  draftText: string;
  stagedNotes: StagedTextNote[];
  pendingUrls: string[];
  pendingFiles: File[];
  selectedIntentTitle: string;
  textWordCount: number;
  saveCaptureCount: number;
}) {
  const { t } = useLocale();
  const trimmedText = draftText.trim();
  const primaryUrl = pendingUrls[0];
  const primaryFile = pendingFiles[0];
  const primaryStagedNote = stagedNotes[0];
  const hasText = trimmedText.length > 0;
  const additionalCount = Math.max(0, saveCaptureCount - 1);

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
  } else if (primaryStagedNote) {
    body = (
      <>
        <CapturePreviewIdentity
          icon={<FileText size={15} />}
          title={t.inbox.sourcePreviewTextCapture}
          description={t.inbox.pendingText(primaryStagedNote.wordCount)}
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
      className="flex h-full min-h-[320px] flex-col rounded-xl border border-border/60 bg-card/65 shadow-sm"
      aria-live="polite"
      aria-label={t.inbox.sourcePreviewTitle}
      data-inbox-source-preview
    >
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-[var(--amber)]" />
          <h3 className="text-sm font-semibold text-foreground">{t.inbox.sourcePreviewTitle}</h3>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
          {saveCaptureCount > 0 ? t.inbox.sourcePreviewActiveDesc : t.inbox.sourcePreviewIdleDesc}
        </p>
      </div>
      <div className="flex flex-1 flex-col px-4 py-4">
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
  onClearSelection,
  onOrganizeSelected,
  onShelveSelected,
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
  onClearSelection?: () => void;
  onOrganizeSelected?: () => void;
  onShelveSelected?: () => void;
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
      className={`overflow-hidden rounded-xl border border-border/60 ${
        isPreview ? 'bg-card/35 shadow-sm scroll-mt-20' : 'bg-card/30 shadow-none'
      }`}
    >
      {isPreview && (
        <div
          className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          data-inbox-queue-section-header
        >
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
          </div>
        </div>
      )}
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
            <InboxQueuePreviewActionBar
              files={files}
              selectedFiles={selectedQueueFiles}
              organizing={organizing}
              onSelectAll={onSelectAll}
              onClearSelection={onClearSelection}
              onOrganize={onOrganizeSelected}
              onShelveSelected={onShelveSelected}
              onOpenWorkbench={onOpenWorkbench}
            />
          )}
          {!isPreview && onOrganizeSelected && onSelectAll && onClearSelection && onProviderChange && onModelChange && (
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
              onClearSelection={onClearSelection}
              onOrganize={onOrganizeSelected}
              onShelveSelected={onShelveSelected}
            />
          )}
          <div className="divide-y divide-border/45">
            {visibleFiles.map((file, idx) => (
              <InboxFileRow
                key={file.path}
                file={file}
                index={idx}
                animate={animateList}
                selected={!isPreview && selectedPath === file.path}
                multiSelect={Boolean(onToggleQueueSelection)}
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

function InboxShelvedSection({
  files,
  inboxError,
  animateList,
  selectedPath,
  onSelectFile,
  onRestore,
  onDelete,
  onRetry,
}: {
  files: InboxFile[];
  inboxError: string | null;
  animateList: boolean;
  selectedPath: string | null;
  onSelectFile: (file: InboxFile) => void;
  onRestore: (file: InboxFile) => void;
  onDelete: (name: string) => void;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const hasFiles = files.length > 0;

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Archive size={15} className="text-[var(--amber)]" />
            <h3 className="text-sm font-semibold text-foreground">{t.inbox.shelvedTitle}</h3>
            {hasFiles && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                {t.inbox.fileCount(files.length)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
            {t.inbox.shelvedDesc}
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
        <div className="divide-y divide-border/50">
          {files.map((file, idx) => (
            <InboxFileRow
              key={file.path}
              file={file}
              index={idx}
              animate={animateList}
              selected={selectedPath === file.path}
              onSelect={() => onSelectFile(file)}
              onDelete={onDelete}
              secondaryAction={{
                label: t.inbox.actionRestore,
                icon: RotateCcw,
                onClick: () => onRestore(file),
              }}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-12 text-center">
          <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-muted/45 text-muted-foreground/50">
            <Archive size={16} />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground/70">{t.inbox.shelvedEmptyTitle}</p>
          <p className="mx-auto mt-1 max-w-[320px] text-xs leading-relaxed text-muted-foreground/55">
            {t.inbox.shelvedEmptyDesc}
          </p>
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
  onClearSelection,
  onOrganize,
  onShelveSelected,
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
  onClearSelection: () => void;
  onOrganize: () => void;
  onShelveSelected?: () => void;
}) {
  const { t } = useLocale();
  const selectedCount = selectedFiles.length;
  const disabled = selectedCount === 0 || organizing;
  const allSelected = files.length > 0 && selectedCount === files.length;

  return (
    <div className="border-b border-border/45 bg-background/35 px-3 py-3" data-inbox-organizer-command-strip>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber)]">
              <Sparkles size={12} />
            </span>
            <h4 className="text-sm font-semibold text-foreground">{t.inbox.organizationCommandTitle}</h4>
            <span className="rounded-md bg-muted/55 px-2 py-0.5 text-2xs font-medium text-muted-foreground">
              {t.inbox.selectedCount(selectedCount)}
            </span>
            {agingCount > 0 && (
              <span className="rounded-md bg-[var(--amber)]/10 px-2 py-0.5 text-2xs font-medium text-[var(--amber)]/75">
                {agingCount} {t.inbox.agingCountLabel}
              </span>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
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
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSelectAll}
              disabled={files.length === 0}
              className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {allSelected ? t.inbox.clearSelection : t.inbox.selectAll}
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
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {onShelveSelected && (
              <button
                type="button"
                onClick={onShelveSelected}
                disabled={disabled}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Archive size={13} />
                {t.inbox.shelveSelectedAction(selectedCount)}
              </button>
            )}
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
    </div>
  );
}

function InboxQueuePreviewActionBar({
  files,
  selectedFiles,
  organizing,
  onSelectAll,
  onClearSelection,
  onOrganize,
  onShelveSelected,
  onOpenWorkbench,
}: {
  files: InboxFile[];
  selectedFiles: InboxFile[];
  organizing: boolean;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onOrganize?: () => void;
  onShelveSelected?: () => void;
  onOpenWorkbench: () => void;
}) {
  const { t } = useLocale();
  const selectedCount = selectedFiles.length;
  const canSelect = Boolean(onSelectAll && onClearSelection);
  const disabled = selectedCount === 0 || organizing;
  const allSelected = files.length > 0 && selectedCount === files.length;

  return (
    <div className="border-b border-border/50 bg-background/45 px-3 py-3" data-inbox-queue-preview-action>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {canSelect && (
              <>
                <button
                  type="button"
                  onClick={onSelectAll}
                  disabled={files.length === 0}
                  className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {allSelected ? t.inbox.clearSelection : t.inbox.selectAll}
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
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {onShelveSelected && (
              <button
                type="button"
                onClick={onShelveSelected}
                disabled={disabled}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Archive size={13} />
                {t.inbox.shelveSelectedAction(selectedCount)}
              </button>
            )}
            {onOrganize && (
              <button
                type="button"
                onClick={onOrganize}
                disabled={disabled}
                className="inline-flex min-w-[142px] items-center justify-center gap-1.5 rounded-lg bg-[var(--amber)] px-3 py-1.5 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {organizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {organizing ? t.inbox.organizing : t.inbox.organizeSelectedAction(selectedCount)}
              </button>
            )}
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
      </div>
    </div>
  );
}
