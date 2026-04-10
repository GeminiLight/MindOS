'use client';

import { useState, useTransition, useCallback, useEffect, useRef, useSyncExternalStore, useMemo, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Edit3, Save, X, Loader2, LayoutTemplate, ArrowLeft, Share2, FileText, Code, MoreHorizontal, Copy, Pencil, Trash2, Star, Download } from 'lucide-react';
import { lazy } from 'react';
import MarkdownView from '@/components/MarkdownView';
import JsonView from '@/components/JsonView';
import CsvView from '@/components/CsvView';
import Backlinks from '@/components/Backlinks';
import { useRendererState } from '@/lib/renderers/useRendererState';
import Breadcrumb from '@/components/Breadcrumb';
import MarkdownEditor, { MdViewMode } from '@/components/MarkdownEditor';
import TableOfContents from '@/components/TableOfContents';
import FindInPage from '@/components/FindInPage';
import { resolveRenderer, isRendererEnabled } from '@/lib/renderers/registry';
import { encodePath } from '@/lib/utils';
import { useLocale } from '@/lib/stores/locale-store';
import DirPicker from '@/components/DirPicker';
import { renameFileAction, deleteFileAction, undoDeleteAction } from '@/lib/actions';
import { toast } from '@/lib/toast';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import { buildLineDiff } from '@/components/changes/line-diff';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import ExportModal from '@/components/ExportModal';

interface ViewPageClientProps {
  filePath: string;
  content: string;
  extension: string;
  saveAction: (content: string) => Promise<void>;
  appendRowAction?: (newRow: string[]) => Promise<{ newContent: string }>;
  initialEditing?: boolean;
  isDraft?: boolean;
  draftDirectories?: string[];
  createDraftAction?: (targetPath: string, content: string) => Promise<void>;
}

export default function ViewPageClient({
  filePath,
  content,
  extension,
  saveAction,
  appendRowAction,
  initialEditing = false,
  isDraft = false,
  draftDirectories = [],
  createDraftAction,
}: ViewPageClientProps) {
  const { t } = useLocale();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(filePath);
  const [exportOpen, setExportOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [useRaw, setUseRaw] = useRendererState<boolean>('_raw', filePath, false);
  // Graph mode — per-view, resets when navigating to a different file
  const [graphMode, setGraphMode] = useState(false);
  const router = useRouter();
  const isBinaryFile = [
    'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
    'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac',
    'mp4', 'webm', 'mov', 'mkv',
  ].includes(extension);
  const [editing, setEditing] = useState(!isBinaryFile && (initialEditing || content === ''));
  const [editContent, setEditContent] = useState(content);
  const [savedContent, setSavedContent] = useState(content);

  // Sync savedContent when server re-renders with new content (e.g. after router.refresh)
  useEffect(() => {
    if (!editing) {
      setSavedContent(content);
    }
  }, [content, editing]);
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>('wysiwyg');
  const [findOpen, setFindOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [, startRenameTransition] = useTransition();

  const inferredName = filePath.split('/').pop() || 'Untitled.md';
  const [showSaveAs, setShowSaveAs] = useState(isDraft);
  const [saveDir, setSaveDir] = useState('');
  const [saveName, setSaveName] = useState(inferredName);

  // Close more menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        moreRef.current && !moreRef.current.contains(e.target as Node) &&
        moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)
      ) setMoreOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [moreOpen]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(filePath).catch(() => {});
    setMoreOpen(false);
  }, [filePath]);

  const handleStartRename = useCallback(() => {
    setMoreOpen(false);
    const name = filePath.split('/').pop() ?? '';
    setRenameValue(name);
    setRenaming(true);
  }, [filePath]);

  const handleCommitRename = useCallback(() => {
    const newName = renameValue.trim();
    if (!newName || newName === filePath.split('/').pop()) { setRenaming(false); return; }
    startRenameTransition(async () => {
      const result = await renameFileAction(filePath, newName);
      setRenaming(false);
      if (result.success && result.newPath) {
        router.push(`/view/${encodePath(result.newPath)}`);
        router.refresh();
        window.dispatchEvent(new Event('mindos:files-changed'));
      }
    });
  }, [renameValue, filePath, router]);

  const handleConfirmDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    const fileName = filePath.split('/').pop() ?? filePath;
    startTransition(async () => {
      const result = await deleteFileAction(filePath);
      if (result.success) {
        if (result.trashId) {
          const trashId = result.trashId;
          toast.undo(`${t.trash?.movedToTrash ?? 'Deleted'} ${fileName}`, async () => {
            const undo = await undoDeleteAction(trashId);
            if (undo.success) {
              router.refresh();
              window.dispatchEvent(new Event('mindos:files-changed'));
            } else {
              toast.error(undo.error ?? 'Undo failed');
            }
          }, { label: t.trash?.undo ?? 'Undo' });
        }
        router.push('/');
        router.refresh();
        window.dispatchEvent(new Event('mindos:files-changed'));
      }
    });
  }, [filePath, router, t]);

  // Keep first paint deterministic between server and client to avoid hydration mismatch.
  const effectiveUseRaw = hydrated ? useRaw : false;

  const handleToggleRaw = useCallback(() => {
    setUseRaw(prev => !prev);
  }, [setUseRaw]);

  const handleToggleGraph = useCallback(() => {
    setGraphMode(prev => !prev);
  }, [setGraphMode]);

  const effectiveGraphMode = graphMode;

  // Resolve renderer: for md files, graph mode overrides normal resolution
  const registryRenderer = resolveRenderer(filePath, extension);
  const graphRenderer = extension === 'md' && effectiveGraphMode
    ? resolveRenderer(filePath, extension, 'graph')
    : undefined;
  const renderer = graphRenderer || registryRenderer;
  const isCsv = extension === 'csv';
  // Graph mode overrides Raw — when graph is active, always show the renderer
  const showRenderer = !editing && !!renderer && (!effectiveUseRaw || !!graphRenderer);

  // Lazily resolve the renderer component for code-splitting
  const LazyComponent = useMemo(() => {
    if (!renderer) return null;
    if (renderer.component) return renderer.component;
    if (renderer.load) return lazy(renderer.load);
    return null;
  }, [renderer]);

  const handleEdit = useCallback(() => {
    setEditContent(savedContent);
    setEditing(true);
    setSaveError(null);
    setSaveSuccess(false);
  }, [savedContent]);

  const handleCancel = useCallback(() => {
    if (isDraft) {
      router.push('/');
      return;
    }
    setEditing(false);
    setSaveError(null);
  }, [isDraft, router]);

  const handleConfirmDraftSave = useCallback(() => {
    const trimmed = saveName.trim();
    if (!trimmed) {
      setSaveError('Please enter a file name');
      return;
    }
    // Reject path traversal and illegal filename characters
    if (/[/\\:*?"<>|]/.test(trimmed) || trimmed.includes('..')) {
      setSaveError('File name contains invalid characters');
      return;
    }
    if (!createDraftAction) {
      setSaveError('Draft save is not available');
      return;
    }

    const finalName = trimmed.endsWith('.md') || trimmed.endsWith('.csv') ? trimmed : `${trimmed}.md`;
    const targetPath = saveDir ? `${saveDir}/${finalName}` : finalName;

    setSaveError(null);
    startTransition(async () => {
      try {
        await createDraftAction(targetPath, editContent);
        setSavedContent(editContent);
        setEditing(false);
        setShowSaveAs(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
        router.push(`/view/${encodePath(targetPath)}`);
        router.refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }, [saveName, createDraftAction, saveDir, editContent, router]);

  const handleSave = useCallback(() => {
    if (isCsv) {
      setEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      return;
    }

    if (isDraft) {
      setShowSaveAs(true);
      return;
    }

    setSaveError(null);
    startTransition(async () => {
      try {
        await saveAction(editContent);
        setSavedContent(editContent);
        setEditing(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }, [isCsv, isDraft, saveAction, editContent]);

  // Renderer's inline save — updates local savedContent without entering edit mode
  const handleRendererSave = useCallback(async (newContent: string) => {
    await saveAction(newContent);
    setSavedContent(newContent);
  }, [saveAction]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (editing) handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !editing) {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === 'e' && !editing && !isBinaryFile && document.activeElement?.tagName === 'BODY') {
        handleEdit();
      }
      if (e.key === 'Escape' && editing) handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, handleSave, handleEdit, handleCancel]);

  // Auto-refresh when AI agent modifies files + compute changed lines for highlight
  const [fileUpdated, setFileUpdated] = useState(false);
  const [changedLines, setChangedLines] = useState<number[]>([]);
  const prevContentRef = useRef(content);
  const aiTriggeredRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When content prop changes after an AI-triggered refresh, compute diff highlights
  useEffect(() => {
    if (!editing && aiTriggeredRef.current && content !== prevContentRef.current && prevContentRef.current !== '') {
      aiTriggeredRef.current = false;
      const diff = buildLineDiff(prevContentRef.current, content);
      const lines: number[] = [];
      let lineNum = 1;
      for (const row of diff) {
        if (row.type === 'insert') {
          lines.push(lineNum);
          lineNum++;
        } else if (row.type === 'equal') {
          lineNum++;
        }
      }
      if (lines.length > 0) {
        setChangedLines(lines);
        // Clear previous timer if any
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setChangedLines([]), 6000);
        // Auto-scroll to change banner
        setTimeout(() => {
          const el = document.querySelector('[data-highlight-line]');
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 100);
      }
    }
    prevContentRef.current = content;
  }, [content, editing]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (editing) return;
      // Debounce rapid file changes (AI may write multiple files in sequence)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        aiTriggeredRef.current = true;
        router.refresh();
        setFileUpdated(true);
        if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
        updatedTimerRef.current = setTimeout(() => setFileUpdated(false), 3000);
      }, 300);
    };
    window.addEventListener('mindos:files-changed', handler);
    return () => {
      window.removeEventListener('mindos:files-changed', handler);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [editing, router]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 h-[46px] flex items-center" style={{ background: 'var(--background)' }}>
        <div className="w-full min-w-0 flex items-center justify-between gap-3 h-full">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <button
              onClick={() => router.back()}
              className="md:hidden p-1 -ml-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label="Go back"
            >
              <ArrowLeft size={16} />
            </button>
            <Breadcrumb filePath={filePath} />
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {fileUpdated && !editing && (
              <span className="text-xs flex items-center gap-1.5 text-[var(--amber)] animate-in fade-in-0 duration-200">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" />
                <span className="hidden sm:inline">updated</span>
              </span>
            )}
            {saveSuccess && (
              <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
                <span className="hidden sm:inline">saved</span>
              </span>
            )}
            {saveError && (
              <span className="text-xs text-error hidden sm:inline">{saveError}</span>
            )}

            {/* Renderer toggle — only shown when a custom renderer exists (excludes graph-mode override and binary files) */}
            {registryRenderer && !editing && !isDraft && !graphRenderer && !isBinaryFile && (
              <button
                onClick={handleToggleRaw}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: effectiveUseRaw ? `${'var(--amber)'}22` : 'var(--muted)',
                  color: effectiveUseRaw ? 'var(--amber)' : 'var(--muted-foreground)',
                }}
                title={effectiveUseRaw ? `Switch to ${registryRenderer?.name}` : 'View raw'}
              >
                {effectiveUseRaw ? <LayoutTemplate size={13} /> : <Code size={13} />}
                <span className="hidden sm:inline">{effectiveUseRaw ? registryRenderer.name : 'Raw'}</span>
              </button>
            )}

            {!editing && !showRenderer && !isDraft && !isBinaryFile && (
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.background = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--muted-foreground)'; e.currentTarget.style.background = 'var(--muted)'; }}
              >
                <Edit3 size={13} />
                <span className="hidden sm:inline">Edit</span>
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={handleCancel}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--muted)'; }}
                >
                  <X size={13} />
                  <span className="hidden sm:inline">Cancel</span>
                </button>
                <button
                  onClick={isDraft && showSaveAs ? handleConfirmDraftSave : handleSave}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                  style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  <span className="hidden sm:inline">Save</span>
                </button>
              </>
            )}

            {/* More menu (rename, copy path, delete) */}
            {!isDraft && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => togglePin(filePath)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title={pinned ? t.fileTree.removeFromFavorites : t.fileTree.pinToFavorites}
                >
                  <Star size={16} className={pinned ? 'fill-[var(--amber)] text-[var(--amber)]' : ''} />
                </button>
                <button
                  ref={moreRef}
                  type="button"
                  onClick={() => setMoreOpen(v => !v)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title={t.view?.more ?? 'More'}
                >
                  <MoreHorizontal size={16} />
                </button>
                {moreOpen && (
                  <div
                    ref={moreMenuRef}
                    className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border bg-card shadow-lg py-1"
                  >
                    {extension === 'md' && !editing && !isDraft && isRendererEnabled('graph') && (
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left" onClick={() => { setMoreOpen(false); handleToggleGraph(); }}>
                        {effectiveGraphMode ? <FileText size={14} className="shrink-0" /> : <Share2 size={14} className="shrink-0" />}
                        {effectiveGraphMode ? (t.view?.switchToDoc ?? 'Document view') : (t.view?.switchToGraph ?? 'Wiki Graph')}
                      </button>
                    )}
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left" onClick={() => { setMoreOpen(false); setExportOpen(true); }}>
                      <Download size={14} className="shrink-0" /> {t.fileTree?.export ?? 'Export'}
                    </button>
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left" onClick={handleCopyPath}>
                      <Copy size={14} className="shrink-0" /> {t.view?.copyPath ?? t.fileTree?.copyPath ?? 'Copy Path'}
                    </button>
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left" onClick={handleStartRename}>
                      <Pencil size={14} className="shrink-0" /> {t.view?.rename ?? 'Rename'}
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors text-left" onClick={() => { setMoreOpen(false); setShowDeleteConfirm(true); }}>
                      <Trash2 size={14} className="shrink-0" /> {t.view?.delete ?? 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 md:px-6 py-6 md:py-8">
        {editing ? (
          <div className="content-width">
            {isDraft && showSaveAs && (
              <div className="mb-3 rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">{t.view?.saveDirectory ?? 'Directory'}</label>
                  <div className="mt-1">
                    <DirPicker
                      dirPaths={draftDirectories}
                      value={saveDir}
                      onChange={setSaveDir}
                      rootLabel={t.home?.rootLevel ?? 'Root'}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">{t.view?.saveFileName ?? 'File name'}</label>
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmDraftSave(); }}
                    className="mt-1 w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Untitled.md"
                  />
                </div>
              </div>
            )}
            {isCsv ? (
              <CsvView
                content={editContent}
                filePath={filePath}
                appendAction={appendRowAction}
                saveAction={async (c) => {
                  await saveAction(c);
                  setEditContent(c);
                  setSavedContent(c);
                }}
              />
            ) : (
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                viewMode={mdViewMode}
                onViewModeChange={setMdViewMode}
              />
            )}
          </div>
        ) : showRenderer && LazyComponent ? (
          <div ref={contentRef} className="content-width">
            {findOpen && <FindInPage containerRef={contentRef} onClose={() => setFindOpen(false)} />}
            <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>}>
              <LazyComponent
                filePath={filePath}
                content={savedContent}
                extension={extension}
                saveAction={handleRendererSave}
              />
            </Suspense>
            <Backlinks filePath={filePath} />
          </div>
        ) : (
          <div ref={contentRef} className="content-width">
            {findOpen && <FindInPage containerRef={contentRef} onClose={() => setFindOpen(false)} />}
            {extension === 'csv' ? (
              <CsvView
                content={savedContent}
                filePath={filePath}
              />
            ) : extension === 'json' ? (
              <JsonView content={savedContent} />
            ) : (
              <>
                <MarkdownView content={savedContent} highlightLines={changedLines} onDismissHighlight={() => setChangedLines([])} emptyPlaceholder={t.view?.emptyNote} />
                <TableOfContents content={savedContent} />
              </>
            )}
            <Backlinks filePath={filePath} />
          </div>
        )}
      </div>

      {/* Inline rename dialog */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg shadow-lg p-4 w-80">
            <h3 className="text-sm font-medium mb-2">Rename</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCommitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setRenaming(false)} className="px-3 py-1.5 rounded-md text-xs bg-muted text-muted-foreground hover:bg-accent transition-colors">{t.view?.cancel ?? 'Cancel'}</button>
              <button onClick={handleCommitRename} className="px-3 py-1.5 rounded-md text-xs bg-[var(--amber)] text-[var(--amber-foreground)] transition-colors">{t.view?.rename ?? 'Rename'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t.view?.delete ?? 'Delete'}
        message={t.view?.deleteConfirm?.(filePath.split('/').pop() ?? '') ?? `Delete "${filePath.split('/').pop()}"?`}
        confirmLabel={t.view?.delete ?? 'Delete'}
        cancelLabel={t.view?.cancel ?? 'Cancel'}
        variant="destructive"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
      />

      {/* Export modal */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filePath={filePath}
        isDirectory={false}
        fileName={filePath.split('/').pop() ?? filePath}
      />
    </div>
  );
}
