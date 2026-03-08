'use client';

import { useState, useTransition, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, Edit3, Save, X, Loader2, Home, LayoutTemplate } from 'lucide-react';
import MarkdownView from '@/components/MarkdownView';
import CsvView from '@/components/CsvView';
import MarkdownEditor, { MdViewMode } from '@/components/MarkdownEditor';
import TableOfContents from '@/components/TableOfContents';
import { resolveRenderer, loadDisabledState } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers

interface ViewPageClientProps {
  filePath: string;
  content: string;
  extension: string;
  saveAction: (content: string) => Promise<void>;
  appendRowAction?: (newRow: string[]) => Promise<{ newContent: string }>;
  initialEditing?: boolean;
}

function Breadcrumb({ filePath }: { filePath: string }) {
  const parts = filePath.split('/');
  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <Link href="/" className="hover:text-foreground transition-colors">
        <Home size={14} />
      </Link>
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        const href = '/view/' + parts.slice(0, i + 1).map(encodeURIComponent).join('/');
        return (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-muted-foreground/50" />
            {isLast ? (
              <span className="text-foreground font-medium" suppressHydrationWarning>{part}</span>
            ) : (
              <Link href={href} className="hover:text-foreground transition-colors truncate max-w-[200px]" suppressHydrationWarning>
                {part}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default function ViewPageClient({
  filePath,
  content,
  extension,
  saveAction,
  appendRowAction,
  initialEditing = false,
}: ViewPageClientProps) {
  const [editing, setEditing] = useState(initialEditing || content === '');
  const [editContent, setEditContent] = useState(content);
  const [savedContent, setSavedContent] = useState(content);
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [useRaw, setUseRaw] = useState(false);
  const [rendererKey, setRendererKey] = useState(0);
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>('wysiwyg');

  // Load disabled state from localStorage on mount
  useEffect(() => {
    loadDisabledState();
    setRendererKey(k => k + 1); // re-resolve renderer after load
  }, []);

  const renderer = resolveRenderer(filePath, extension);
  // rendererKey forces re-evaluation after disabled state loads from localStorage
  void rendererKey;
  const isCsv = extension === 'csv';
  const showRenderer = !editing && !useRaw && !!renderer;

  const handleEdit = useCallback(() => {
    setEditContent(savedContent);
    setEditing(true);
    setSaveError(null);
    setSaveSuccess(false);
  }, [savedContent]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(() => {
    if (isCsv) {
      // CSV cells are written on each change; Save just exits editing mode
      setEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
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
  }, [isCsv, saveAction, editContent]);

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
        <div className="max-w-[900px] mx-auto xl:mr-[220px] flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Breadcrumb filePath={filePath} />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {saveSuccess && (
              <span className="text-xs flex items-center gap-1.5" style={{ color: '#7aad80', fontFamily: "'IBM Plex Mono', monospace" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#7aad80' }} />
                <span className="hidden sm:inline">saved</span>
              </span>
            )}
            {saveError && (
              <span className="text-xs text-red-400 hidden sm:inline">{saveError}</span>
            )}

            {/* Renderer toggle — only shown when a custom renderer exists */}
            {renderer && !editing && (
              <button
                onClick={() => setUseRaw(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: useRaw ? 'var(--muted)' : 'var(--amber)' + '22',
                  color: useRaw ? 'var(--muted-foreground)' : 'var(--amber)',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                title={useRaw ? `Switch to ${renderer.name}` : 'View raw'}
              >
                <LayoutTemplate size={13} />
                <span className="hidden sm:inline">{useRaw ? renderer.name : 'Raw'}</span>
              </button>
            )}

            {!editing && !showRenderer && (
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono', monospace" }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.background = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted-foreground)'; e.currentTarget.style.background = 'var(--muted)'; }}
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
                  style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono', monospace" }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--muted)'; }}
                >
                  <X size={13} />
                  <span className="hidden sm:inline">Cancel</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                  style={{ background: 'var(--amber)', color: '#131210', fontFamily: "'IBM Plex Mono', monospace" }}
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
      <div className="flex-1 px-6 py-8">
        {editing ? (
          <div className="max-w-[900px] mx-auto xl:mr-[220px]">
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
        ) : showRenderer ? (
          <renderer.component
            filePath={filePath}
            content={savedContent}
            extension={extension}
            saveAction={handleRendererSave}
          />
        ) : (
          <div className="max-w-[900px] mx-auto xl:mr-[220px]">
            {extension === 'csv' ? (
              <CsvView
                content={savedContent}
                filePath={filePath}
              />
            ) : (
              <>
                <MarkdownView content={savedContent} />
                <TableOfContents content={savedContent} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
