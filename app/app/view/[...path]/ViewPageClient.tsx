'use client';

import { useState, useTransition, useCallback, useEffect, useRef, useSyncExternalStore, useMemo, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Edit3, Save, X, Loader2, LayoutTemplate, ArrowLeft } from 'lucide-react';
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
import { resolveRenderer } from '@/lib/renderers/registry';
import { encodePath } from '@/lib/utils';
import '@/lib/renderers/index'; // registers all renderers

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
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [useRaw, setUseRaw] = useRendererState<boolean>('_raw', filePath, false);
  const router = useRouter();
  const [editing, setEditing] = useState(initialEditing || content === '');
  const [editContent, setEditContent] = useState(content);
  const [savedContent, setSavedContent] = useState(content);
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>('wysiwyg');
  const [findOpen, setFindOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const inferredName = filePath.split('/').pop() || 'Untitled.md';
  const [showSaveAs, setShowSaveAs] = useState(isDraft);
  const [saveDir, setSaveDir] = useState('');
  const [saveName, setSaveName] = useState(inferredName);

  // Keep first paint deterministic between server and client to avoid hydration mismatch.
  const effectiveUseRaw = hydrated ? useRaw : false;

  const handleToggleRaw = useCallback(() => {
    setUseRaw(prev => !prev);
  }, [setUseRaw]);

  const renderer = resolveRenderer(filePath, extension);
  const isCsv = extension === 'csv';
  const showRenderer = !editing && !effectiveUseRaw && !!renderer;

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
      if (e.key === 'e' && !editing && document.activeElement?.tagName === 'BODY') {
        handleEdit();
      }
      if (e.key === 'Escape' && editing) handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, handleSave, handleEdit, handleCancel]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 py-2.5" style={{ background: 'var(--background)' }}>
        <div className="content-width xl:mr-[220px] flex items-center justify-between gap-2">
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
            {saveSuccess && (
              <span className="text-xs flex items-center gap-1.5 font-display" style={{ color: '#7aad80' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#7aad80' }} />
                <span className="hidden sm:inline">saved</span>
              </span>
            )}
            {saveError && (
              <span className="text-xs text-red-400 hidden sm:inline">{saveError}</span>
            )}

            {/* Renderer toggle — only shown when a custom renderer exists */}
            {renderer && !editing && !isDraft && (
              <button
                onClick={handleToggleRaw}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors font-display"
                style={{
                  background: effectiveUseRaw ? 'var(--muted)' : `${'var(--amber)'}22`,
                  color: effectiveUseRaw ? 'var(--muted-foreground)' : 'var(--amber)',
                }}
                title={effectiveUseRaw ? `Switch to ${renderer.name}` : 'View raw'}
              >
                <LayoutTemplate size={13} />
                <span className="hidden sm:inline">{effectiveUseRaw ? renderer.name : 'Raw'}</span>
              </button>
            )}

            {!editing && !showRenderer && !isDraft && (
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors font-display"
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 font-display"
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 font-display"
                  style={{ background: 'var(--amber)', color: '#131210' }}
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  <span className="hidden sm:inline">Save</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 md:px-6 py-6 md:py-8">
        {editing ? (
          <div className="content-width xl:mr-[220px]">
            {isDraft && showSaveAs && (
              <div className="mb-3 rounded-lg border border-border bg-card p-3 flex flex-col md:flex-row md:items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-muted-foreground">Directory</label>
                  <select
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-border rounded text-foreground"
                  >
                    <option value="">/</option>
                    {draftDirectories.map((dir) => (
                      <option key={dir} value={dir}>{dir}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground">File name</label>
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmDraftSave(); }}
                    className="mt-1 w-full px-2 py-1.5 text-sm bg-background border border-border rounded text-foreground"
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
          <div ref={contentRef} className="content-width xl:mr-[220px]">
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
          <div ref={contentRef} className="content-width xl:mr-[220px]">
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
                <MarkdownView content={savedContent} />
                <TableOfContents content={savedContent} />
              </>
            )}
            <Backlinks filePath={filePath} />
          </div>
        )}
      </div>
    </div>
  );
}
