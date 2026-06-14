'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, X, FileText, Table, ChevronRight, Eye, GripVertical, Terminal } from 'lucide-react';
import { SearchResult } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import { toast } from '@/lib/toast';
import PanelHeader from './PanelHeader';
import { Virtuoso } from 'react-virtuoso';
import { getSearchWarmHint, shouldStartSearchPrewarm, useSearchPrewarm } from '@/hooks/useSearchPrewarm';
import {
  choosePluginMenuItem,
  choosePluginModalSuggestion,
  executePluginCommandSurface,
  fetchPluginCommandSurfaces,
  firstPluginActionMenuSnapshot,
  firstPluginActionModalSnapshot,
  firstPluginActionTargetPath,
  matchesPluginCommandQuery,
  pluginCommandHotkeyLabel,
  pluginCommandHotkeyConflictSummary,
  pluginEditorCommandContextForPathname,
  pluginCommandHotkeyPolicyLabel,
  toastPluginActionNotices,
  type PluginMenuSnapshot,
  type PluginModalSnapshot,
  type PluginModalSuggestionChoice,
} from '@/lib/plugins/client';
import type { PluginSurface } from '@/lib/plugins/surfaces';
import { openTab } from '@/lib/workspace-tabs';
import PluginActionModalDialog from '@/components/plugins/PluginActionModalDialog';
import PluginActionMenuDialog from '@/components/plugins/PluginActionMenuDialog';
import { createSearchResultDragPreview, scheduleSearchResultDragPreviewCleanup } from '@/lib/search-drag-preview';

/** Highlight matched text fragments in a snippet based on the query */
function highlightSnippet(snippet: string, query: string): React.ReactNode {
  if (!query.trim()) return snippet;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = snippet.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? <mark key={i} className="bg-[var(--amber)]/25 text-foreground rounded-sm px-0.5">{part}</mark> : part
  );
}

/** Format file path as breadcrumb for cleaner display */
function formatPath(fullPath: string): { name: string; breadcrumb: string[] } {
  const parts = fullPath.split('/').filter(Boolean);
  const name = parts[parts.length - 1];
  const breadcrumb = parts.slice(0, -1);
  return { name, breadcrumb };
}

interface SearchPanelProps {
  /** When true the panel is visible — triggers focus & reset */
  active: boolean;
  /** Increments when an external trigger wants to refocus the existing panel */
  focusRequest?: number;
  /** Called when user navigates to a result (panel host may want to close) */
  onNavigate?: () => void;
  onClose?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
}

export { getSearchWarmHint, shouldStartSearchPrewarm } from '@/hooks/useSearchPrewarm';

export default function SearchPanel({ active, focusRequest = 0, onNavigate, onClose, maximized, onMaximize }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [pluginCommands, setPluginCommands] = useState<PluginSurface[]>([]);
  const [pluginModal, setPluginModal] = useState<PluginModalSnapshot | null>(null);
  const [pluginMenu, setPluginMenu] = useState<PluginMenuSnapshot | null>(null);
  const [choosingSuggestionIndex, setChoosingSuggestionIndex] = useState<number | null>(null);
  const [modalChoiceError, setModalChoiceError] = useState<string | null>(null);
  const [choosingMenuItemIndex, setChoosingMenuItemIndex] = useState<number | null>(null);
  const [menuChoiceError, setMenuChoiceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const pluginEditorContext = useMemo(() => pluginEditorCommandContextForPathname(pathname), [pathname]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLocale();
  const searchTitle = t.sidebar?.searchTitle ?? t.search.tabSearch ?? 'Search';

  // Focus input when panel becomes active
  useEffect(() => {
    if (active) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [active, focusRequest]);

  const warmState = useSearchPrewarm(active);
  const visiblePluginCommands = useMemo(
    () => pluginCommands.filter((surface) => matchesPluginCommandQuery(surface, query)),
    [pluginCommands, query],
  );
  const selectedFileIndex = selectedIndex - visiblePluginCommands.length;
  const selectableCount = visiblePluginCommands.length + results.length;

  // ── Preview state ──
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch preview content when selected result changes (debounced 150ms)
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);

    if (results.length === 0 || selectedFileIndex < 0 || selectedFileIndex >= results.length) {
      setPreviewContent(null);
      setPreviewPath(null);
      return;
    }

    const result = results[selectedFileIndex];
    if (result.path === previewPath && previewContent !== null) return;

    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const data = await apiFetch<{ content: string }>(`/api/file?path=${encodeURIComponent(result.path)}`);
        setPreviewContent(typeof data.content === 'string' ? data.content.slice(0, 2000) : null);
        setPreviewPath(result.path);
      } catch {
        setPreviewContent(null);
        setPreviewPath(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 150);

    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, selectedFileIndex]);

  // Clear preview when query changes
  useEffect(() => {
    setPreviewContent(null);
    setPreviewPath(null);
  }, [query]);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const data = await apiFetch<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(Array.isArray(data) ? data : []);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
  }, [doSearch]);

  const navigate = useCallback((result: SearchResult) => {
    router.push(`/view/${encodePath(result.path)}`);
    onNavigate?.();
  }, [router, onNavigate]);

  const applyPluginActionResult = useCallback((result: Awaited<ReturnType<typeof choosePluginModalSuggestion>>) => {
    const showedNotice = toastPluginActionNotices(result);
    const targetPath = firstPluginActionTargetPath(result);
    if (targetPath) {
      openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
      router.push(`/view/${encodePath(targetPath)}`);
      onNavigate?.();
      toast.success(`Opened ${targetPath}`);
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }
    if (result.editorUpdates?.some((update) => update.changed)) {
      window.dispatchEvent(new Event('mindos:files-changed'));
      router.refresh();
      toast.success(`Updated ${result.editorUpdates[0]?.sourcePath ?? 'current note'}`);
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }

    const modal = firstPluginActionModalSnapshot(result);
    if (modal) {
      setPluginModal(modal);
      setPluginMenu(null);
      return;
    }

    const menu = firstPluginActionMenuSnapshot(result);
    if (menu) {
      setPluginMenu(menu);
      setPluginModal(null);
      return;
    }

    setPluginModal(null);
    if (!showedNotice) {
      toast.success('Plugin suggestion applied');
    }
  }, [router, onNavigate]);

  const chooseModalSuggestion = useCallback(async (modal: PluginModalSnapshot, suggestion: PluginModalSuggestionChoice) => {
    setChoosingSuggestionIndex(suggestion.index);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await choosePluginModalSuggestion(modal.id, suggestion.index, modal.interactionId);
      applyPluginActionResult(result);
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin suggestion');
    } finally {
      setChoosingSuggestionIndex(null);
    }
  }, [applyPluginActionResult]);

  const chooseMenuItem = useCallback(async (menu: PluginMenuSnapshot, item: PluginMenuSnapshot['items'][number]) => {
    setChoosingMenuItemIndex(item.index);
    setMenuChoiceError(null);
    try {
      if (!menu.interactionId) {
        throw new Error('Plugin menu interaction expired. Run the command again.');
      }
      const result = await choosePluginMenuItem(menu.id, item.index, menu.interactionId);
      applyPluginActionResult(result);
    } catch (error) {
      setMenuChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin menu item');
    } finally {
      setChoosingMenuItemIndex(null);
    }
  }, [applyPluginActionResult]);

  const runPluginCommand = useCallback(async (surface: PluginSurface) => {
    try {
      const result = await executePluginCommandSurface(surface, pluginEditorContext);
      const showedNotice = toastPluginActionNotices(result);
      const targetPath = firstPluginActionTargetPath(result);
      if (targetPath) {
        openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
        router.push(`/view/${encodePath(targetPath)}`);
        onNavigate?.();
        toast.success(`Opened ${targetPath}`);
      } else if (result.editorUpdates?.some((update) => update.changed)) {
        window.dispatchEvent(new Event('mindos:files-changed'));
        router.refresh();
        toast.success(`Updated ${result.editorUpdates[0]?.sourcePath ?? 'current note'}`);
      } else {
        const modal = firstPluginActionModalSnapshot(result);
        if (modal) {
          setPluginModal(modal);
        } else {
          const menu = firstPluginActionMenuSnapshot(result);
          if (menu) {
            setPluginMenu(menu);
          } else if (!showedNotice) {
            toast.success(`Ran ${surface.title}`);
          }
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run plugin command');
    }
  }, [pluginEditorContext, router, onNavigate]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetchPluginCommandSurfaces(pluginEditorContext)
      .then((surfaces) => {
        if (!cancelled) setPluginCommands(surfaces);
      })
      .catch(() => {
        if (!cancelled) setPluginCommands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, pluginEditorContext]);

  useEffect(() => {
    if (selectableCount === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, selectableCount - 1));
  }, [selectableCount]);

  // Keyboard navigation within the panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, Math.max(selectableCount - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (selectedIndex < visiblePluginCommands.length) {
        const command = visiblePluginCommands[selectedIndex];
        if (command) void runPluginCommand(command);
        return;
      }
      if (results[selectedFileIndex]) navigate(results[selectedFileIndex]);
    }
  }, [results, selectedIndex, selectedFileIndex, selectableCount, navigate, visiblePluginCommands, runPluginCommand]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent<HTMLButtonElement>, result: SearchResult, index: number) => {
    e.dataTransfer.effectAllowed = 'copy';
    // Use the same data format as MindOS knowledge base drag-drop
    e.dataTransfer.setData('text/mindos-path', result.path);
    e.dataTransfer.setData('text/mindos-type', 'file');
    e.dataTransfer.setData('text/plain', result.path);
    const preview = createSearchResultDragPreview(result.path);
    if (preview && typeof e.dataTransfer.setDragImage === 'function') {
      e.dataTransfer.setDragImage(preview, 12, 12);
    }
    scheduleSearchResultDragPreviewCleanup(preview);
    setDraggedIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
  }, []);

  const warmHint = getSearchWarmHint(warmState, query, {
    preparing: t.search.preparing,
    fallbackWarmHint: t.search.fallbackWarmHint,
  });

  return (
    <>
      {/* Header */}
      <PanelHeader title={searchTitle} maximized={maximized} onMaximize={onMaximize}>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
            aria-label={t.search.close}
            title={t.search.close}
          >
            <X size={13} />
          </button>
        )}
      </PanelHeader>

      {/* Search input */}
      <div className="px-3 py-2.5 border-b border-border shrink-0 overflow-hidden">
        <div className="flex items-center gap-3 overflow-hidden">
          <Search size={15} className="text-muted-foreground shrink-0 flex-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            className="flex-1 min-w-0 bg-transparent text-foreground text-sm font-medium placeholder:text-muted-foreground/55 outline-none"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin shrink-0 flex-none" />
          )}
          {!loading && query && (
            <button
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
              className="shrink-0 flex-none p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t.search.clear}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {warmHint && (
          <p className="mt-2 text-xs text-muted-foreground/70">{warmHint}</p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto min-h-0" role="listbox" aria-label="Search results">
        {/* Empty state with prompt */}
        {results.length === 0 && visiblePluginCommands.length === 0 && !query && !loading && (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
              <Search size={20} className="text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">{t.search.emptyTitle}</h3>
            <p className="text-xs text-muted-foreground/70">
              {t.search.emptyHint}
            </p>
          </div>
        )}

        {/* No results state */}
        {results.length === 0 && visiblePluginCommands.length === 0 && query && !loading && (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
              <Search size={20} className="text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">{t.search.noResults}</h3>
            <p className="text-xs text-muted-foreground/70">
              {t.search.noResultsHint}
            </p>
          </div>
        )}

        {/* Loading skeleton cards */}
        {loading && results.length === 0 && (
          <div className="space-y-2 p-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-3 py-2.5 space-y-2 animate-pulse">
                <div className="h-4 bg-muted rounded-md w-3/4" />
                <div className="h-3 bg-muted rounded-md w-1/2" />
                <div className="h-3 bg-muted rounded-md w-2/3" />
              </div>
            ))}
          </div>
        )}

        {visiblePluginCommands.length > 0 && (
          <div className="border-b border-border/50 py-1">
            <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Plugin commands
            </div>
            {visiblePluginCommands.map((surface, i) => {
              const isSelected = i === selectedIndex;
              const shortcut = pluginCommandHotkeyLabel(surface);
              const shortcutPolicy = pluginCommandHotkeyPolicyLabel(surface);
              const shortcutTitle = pluginCommandHotkeyConflictSummary(surface) ?? undefined;
              return (
                <button
                  key={surface.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => void runPluginCommand(surface)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`
                    group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors duration-100
                    ${isSelected ? 'border-[var(--amber)] bg-[var(--amber-dim)]' : 'border-transparent hover:bg-muted/60'}
                  `}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
                    <Terminal size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{surface.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{surface.pluginName}</span>
                  </span>
                  {shortcut && (
                    <span className="ml-auto flex shrink-0 items-center gap-1.5" title={shortcutTitle}>
                      <kbd className="rounded border border-border bg-background/70 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                        {shortcut}
                      </kbd>
                      {shortcutPolicy === 'Conflict' && (
                        <span className="rounded border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-1.5 py-0.5 text-2xs font-medium text-[var(--amber-text)]">
                          Conflict
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Results list */}
        {results.length > 0 && (
          <Virtuoso
            totalCount={results.length}
            overscan={100}
            itemContent={(i) => {
              const result = results[i];
              const ext = result.path.endsWith('.csv') ? '.csv' : '.md';
              const { name, breadcrumb } = formatPath(result.path);
              const isSelected = visiblePluginCommands.length + i === selectedIndex;
              const isDragging = i === draggedIndex;

              return (
                <button
                  role="option"
                  aria-selected={isSelected}
                  draggable
                  onDragStart={(e) => handleDragStart(e, result, i)}
                  onDragEnd={handleDragEnd}
                  onDragEnter={() => setDraggedIndex(i)}
                  onDragLeave={() => setDraggedIndex(null)}
                  onClick={() => navigate(result)}
                  onMouseEnter={() => setSelectedIndex(visiblePluginCommands.length + i)}
                  className={`
                    group w-full px-3 py-2.5 flex items-start gap-3 text-left transition-colors duration-100
                    border-b border-border/50
                    ${isSelected ? 'bg-[var(--amber-dim)] border-l-2 border-[var(--amber)]' : 'border-l-2 border-transparent'}
                    ${isDragging ? 'bg-muted/70' : isSelected ? '' : 'hover:bg-muted/60'}
                  `}
                >
                  {/* File icon */}
                  <div className="shrink-0 flex-none mt-0.5">
                    {ext === '.csv'
                      ? <Table size={14} className="text-success" />
                      : <FileText size={14} className="text-muted-foreground" />
                    }
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {/* File name - elevated */}
                    <div className="text-sm font-semibold text-foreground truncate" title={name}>
                      {name}
                    </div>

                    {/* Breadcrumb path - muted */}
                    {breadcrumb.length > 0 && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground/70 truncate">
                        {breadcrumb.map((part, idx) => (
                          <span key={idx} className="flex items-center gap-1">
                            {idx > 0 && <ChevronRight size={10} className="shrink-0 flex-none" />}
                            <span className="truncate">{part}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Content snippet - muted and small */}
                    {result.snippet && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed" title={result.snippet}>
                        {highlightSnippet(result.snippet, query)}
                      </p>
                    )}
                  </div>

                  {/* Drag affordance */}
                  {isSelected && !isDragging && (
                    <span
                      className="hidden md:inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/45 transition-colors group-hover:text-muted-foreground"
                      title={t.search.dragToChat}
                      aria-label={t.search.dragToChat}
                    >
                      <GripVertical size={13} aria-hidden="true" />
                    </span>
                  )}
                </button>
              );
            }}

          />
        )}
      </div>

      {/* Preview pane — shows content of selected result */}
      {selectedFileIndex >= 0 && results.length > 0 && (previewContent || previewLoading) && (
        <div className="border-t border-border shrink-0 max-h-[30%] overflow-y-auto">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border-b border-border/50 sticky top-0 bg-card z-10">
            <Eye size={12} className="shrink-0" />
            <span className="truncate">{previewPath ?? ''}</span>
          </div>
          {previewLoading && !previewContent ? (
            <div className="px-3 py-4 space-y-2 animate-pulse">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-4/6" />
            </div>
          ) : previewContent ? (
            <pre className="px-3 py-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words font-sans">
              {previewContent}
              {previewContent.length >= 2000 && (
                <span className="text-muted-foreground/40"> …</span>
              )}
            </pre>
          ) : null}
        </div>
      )}

      {/* Footer hints */}
      {selectableCount > 0 && (
        <div className="px-3 py-2 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground/60 shrink-0">
          <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↑↓</kbd> {t.search.navigate}</span>
          <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↵</kbd> {t.search.open}</span>
          <span className="text-muted-foreground/40 mx-0.5">•</span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded bg-muted/40 text-muted-foreground/70"
              aria-hidden="true"
            >
              <GripVertical size={12} />
            </span>
            {t.search.dragToChat}
          </span>
        </div>
      )}

      <PluginActionModalDialog
        modal={pluginModal}
        onChooseSuggestion={(modal, suggestion) => void chooseModalSuggestion(modal, suggestion)}
        choosingSuggestionIndex={choosingSuggestionIndex}
        choiceError={modalChoiceError}
        onClose={() => {
          setPluginModal(null);
          setModalChoiceError(null);
        }}
      />
      <PluginActionMenuDialog
        menu={pluginMenu}
        onChooseItem={(menu, item) => void chooseMenuItem(menu, item)}
        choosingItemIndex={choosingMenuItemIndex}
        choiceError={menuChoiceError}
        onClose={() => {
          setPluginMenu(null);
          setMenuChoiceError(null);
        }}
      />
    </>
  );
}
