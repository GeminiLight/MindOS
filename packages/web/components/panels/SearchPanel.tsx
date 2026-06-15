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
import { isPathAffected, notifyFilesChanged, subscribeFilesChanged } from '@/lib/files-changed';

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

const SEARCH_PREVIEW_CACHE_LIMIT = 25;

function rememberPreview(cache: Map<string, string | null>, path: string, content: string | null): void {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, content);
  if (cache.size <= SEARCH_PREVIEW_CACHE_LIMIT) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
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
  const searchAbort = useRef<AbortController | null>(null);
  const searchRequestId = useRef(0);
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
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCache = useRef(new Map<string, string | null>());
  const previewAbort = useRef<AbortController | null>(null);
  const previewRequestId = useRef(0);
  const selectedPreviewPath = selectedFileIndex >= 0 && selectedFileIndex < results.length
    ? results[selectedFileIndex]?.path ?? null
    : null;

  useEffect(() => {
    return subscribeFilesChanged((paths) => {
      const cachedPaths = Array.from(previewCache.current.keys());
      const changedCurrent = selectedPreviewPath
        ? !paths || isPathAffected(paths, selectedPreviewPath)
        : false;

      if (!paths) {
        previewCache.current.clear();
      } else {
        for (const cachedPath of cachedPaths) {
          if (isPathAffected(paths, cachedPath)) {
            previewCache.current.delete(cachedPath);
          }
        }
      }

      if (!changedCurrent) return;
      previewRequestId.current += 1;
      previewAbort.current?.abort();
      setPreviewContent(null);
      setPreviewPath(null);
      setPreviewLoading(false);
      setPreviewGeneration((generation) => generation + 1);
    });
  }, [selectedPreviewPath]);

  // Fetch preview content when selected result changes (debounced 150ms)
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewAbort.current?.abort();

    if (results.length === 0 || selectedFileIndex < 0 || selectedFileIndex >= results.length) {
      setPreviewContent(null);
      setPreviewPath(null);
      setPreviewLoading(false);
      return;
    }

    const result = results[selectedFileIndex];
    if (previewCache.current.has(result.path)) {
      setPreviewContent(previewCache.current.get(result.path) ?? null);
      setPreviewPath(result.path);
      setPreviewLoading(false);
      return;
    }

    previewTimer.current = setTimeout(async () => {
      const requestId = previewRequestId.current + 1;
      previewRequestId.current = requestId;
      const controller = new AbortController();
      previewAbort.current = controller;
      setPreviewLoading(true);
      try {
        const data = await apiFetch<{ content: string }>(
          `/api/file?path=${encodeURIComponent(result.path)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || previewRequestId.current !== requestId) return;
        const nextContent = typeof data.content === 'string' ? data.content.slice(0, 2000) : null;
        rememberPreview(previewCache.current, result.path, nextContent);
        setPreviewContent(nextContent);
        setPreviewPath(result.path);
      } catch {
        if (controller.signal.aborted || previewRequestId.current !== requestId) return;
        setPreviewContent(null);
        setPreviewPath(null);
      } finally {
        if (!controller.signal.aborted && previewRequestId.current === requestId) {
          setPreviewLoading(false);
        }
      }
    }, 150);

    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewAbort.current?.abort();
    };
  }, [results, selectedFileIndex, previewGeneration]);

  // Clear preview when query changes
  useEffect(() => {
    previewRequestId.current += 1;
    previewAbort.current?.abort();
    setPreviewContent(null);
    setPreviewPath(null);
    setPreviewLoading(false);
  }, [query]);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    searchAbort.current?.abort();
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbort.current = controller;
      try {
        const data = await apiFetch<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (controller.signal.aborted || searchRequestId.current !== requestId) return;
        setResults(Array.isArray(data) ? data : []);
        setSelectedIndex(0);
      } catch {
        if (controller.signal.aborted || searchRequestId.current !== requestId) return;
        setResults([]);
      } finally {
        if (!controller.signal.aborted && searchRequestId.current === requestId) {
          setLoading(false);
        }
      }
    }, 300);
  }, []);

  useEffect(() => {
    if (active) return;
    searchRequestId.current += 1;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    searchAbort.current?.abort();
    setLoading(false);
  }, [active]);

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    searchAbort.current?.abort();
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
    const changedPaths = result.editorUpdates
      ?.flatMap((update) => update.changed && update.sourcePath ? [update.sourcePath] : []);
    if (result.editorUpdates?.some((update) => update.changed)) {
      notifyFilesChanged(changedPaths);
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
        notifyFilesChanged(
          result.editorUpdates.flatMap((update) => update.changed && update.sourcePath ? [update.sourcePath] : []),
        );
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
      <div className="shrink-0 overflow-hidden border-b border-border/70 px-3 py-3">
        <div className="group/search flex min-h-11 items-center gap-2.5 overflow-hidden rounded-lg border border-border/65 bg-background/45 px-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] transition-[background-color,border-color,box-shadow] duration-150 focus-within:border-[var(--amber)]/45 focus-within:bg-background/70 focus-within:shadow-[inset_3px_0_0_var(--amber)]">
          <Search size={16} className="shrink-0 flex-none text-muted-foreground transition-colors duration-150 group-focus-within/search:text-[var(--amber)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/55"
          />
          {loading && (
            <div className="h-4 w-4 shrink-0 flex-none animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          )}
          {!loading && query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
              className="hit-target-box inline-flex h-7 w-7 shrink-0 flex-none items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
              aria-label={t.search.clear}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {warmHint && (
          <p className="mt-2 px-1 text-xs text-muted-foreground/70">{warmHint}</p>
        )}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" role="listbox" aria-label="Search results">
        {/* Empty state with prompt */}
        {results.length === 0 && visiblePluginCommands.length === 0 && !query && !loading && (
          <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border/60 bg-muted/45">
              <Search size={18} className="text-muted-foreground/60" />
            </div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{t.search.emptyTitle}</h3>
            <p className="max-w-[15rem] text-xs leading-relaxed text-muted-foreground/70">
              {t.search.emptyHint}
            </p>
          </div>
        )}

        {/* No results state */}
        {results.length === 0 && visiblePluginCommands.length === 0 && query && !loading && (
          <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border/60 bg-muted/45">
              <Search size={18} className="text-muted-foreground/60" />
            </div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{t.search.noResults}</h3>
            <p className="max-w-[15rem] text-xs leading-relaxed text-muted-foreground/70">
              {t.search.noResultsHint}
            </p>
          </div>
        )}

        {/* Loading skeleton cards */}
        {loading && results.length === 0 && (
          <div className="space-y-1.5 p-1">
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-2 rounded-md border border-border/35 bg-background/25 px-3 py-3 animate-pulse">
                <div className="h-3.5 w-3/4 rounded-md bg-muted" />
                <div className="h-3 w-1/2 rounded-md bg-muted/80" />
                <div className="h-3 w-2/3 rounded-md bg-muted/70" />
              </div>
            ))}
          </div>
        )}

        {visiblePluginCommands.length > 0 && (
          <div className="mb-2 py-1">
            <div className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/80">
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
                    group flex w-full items-center gap-3 rounded-md border px-2.5 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-100
                    ${isSelected ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] shadow-[inset_3px_0_0_var(--amber)]' : 'border-transparent hover:bg-muted/45'}
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
                    mb-1 flex w-full items-start gap-3 rounded-md border px-2.5 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-100
                    ${isSelected ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] shadow-[inset_3px_0_0_var(--amber)]' : 'border-transparent'}
                    ${isDragging ? 'bg-muted/70' : isSelected ? '' : 'hover:bg-muted/45'}
                  `}
                >
                  {/* File icon */}
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 flex-none items-center justify-center rounded-md transition-colors ${
                    isSelected ? 'bg-[var(--amber)]/10' : 'bg-muted/45'
                  }`}>
                    {ext === '.csv'
                      ? <Table size={14} className="text-success" />
                      : <FileText size={14} className={isSelected ? 'text-[var(--amber)]' : 'text-muted-foreground'} />
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

                  {/* Drag hint */}
                  {isSelected && !isDragging && (
                    <div className="flex shrink-0 flex-none items-center gap-1 pt-0.5 text-[10px] font-medium text-muted-foreground/50">
                      <GripVertical size={13} aria-hidden="true" />
                      <span>Drag</span>
                    </div>
                  )}
                </button>
              );
            }}

          />
        )}
      </div>

      {/* Preview pane — shows content of selected result */}
      {selectedFileIndex >= 0 && results.length > 0 && (previewContent || previewLoading) && (
        <div className="max-h-[32%] shrink-0 overflow-y-auto border-t border-border bg-background/25">
          <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border/50 bg-card px-3 py-1.5 text-xs text-muted-foreground">
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
            <pre className="px-3.5 py-3 font-sans text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
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
        <div className="flex shrink-0 items-center gap-2 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground/60">
          <span><kbd className="rounded border border-border/50 bg-muted/35 px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> {t.search.navigate}</span>
          <span><kbd className="rounded border border-border/50 bg-muted/35 px-1 py-0.5 font-mono text-[10px]">↵</kbd> {t.search.open}</span>
          <span className="text-muted-foreground/40 mx-0.5">•</span>
          <span><kbd className="rounded border border-border/50 bg-muted/35 px-1 py-0.5 font-mono text-[10px]">Drag</kbd> {t.search.dragToChat}</span>
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
