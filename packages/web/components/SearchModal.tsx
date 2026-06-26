'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, X, FileText, Table, Settings, RotateCcw, Moon, Sun, Bot, Compass, HelpCircle, ChevronRight, GripVertical, Terminal, Sparkles } from 'lucide-react';
import { SearchResult } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import { toast } from '@/lib/toast';
import { getSearchWarmHint, useSearchPrewarm } from '@/hooks/useSearchPrewarm';
import {
  choosePluginMenuItem,
  choosePluginModalSuggestion,
  executePluginCommandSurface,
  fetchPluginCommandSurfaces,
  firstPluginActionMenuSnapshot,
  firstPluginActionModalSnapshot,
  firstPluginActionTargetPath,
  pluginCommandLabel,
  pluginCommandHotkeyLabel,
  pluginCommandHotkeyConflictSummary,
  pluginEditorCommandContextForPathname,
  pluginCommandHotkeyPolicyLabel,
  submitPluginModalText,
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
import { notifyFilesChanged } from '@/lib/files-changed';
import { restartWalkthrough } from '@/lib/stores/walkthrough-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { highlightSearchSnippet } from '@/lib/search-highlight';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

type PaletteTab = 'search' | 'actions';

interface CommandAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  shortcutPolicy?: string;
  shortcutTitle?: string;
  execute: () => void;
}

/** Format file path as breadcrumb for cleaner display */
function formatPath(fullPath: string): { name: string; breadcrumb: string[] } {
  const parts = fullPath.split('/').filter(Boolean);
  const name = parts[parts.length - 1];
  const breadcrumb = parts.slice(0, -1);
  return { name, breadcrumb };
}

export default function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState<PaletteTab>('search');
  const [actionIndex, setActionIndex] = useState(0);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [pluginCommands, setPluginCommands] = useState<PluginSurface[]>([]);
  const [pluginModal, setPluginModal] = useState<PluginModalSnapshot | null>(null);
  const [pluginMenu, setPluginMenu] = useState<PluginMenuSnapshot | null>(null);
  const [choosingSuggestionIndex, setChoosingSuggestionIndex] = useState<number | null>(null);
  const [submittingModalText, setSubmittingModalText] = useState(false);
  const [modalChoiceError, setModalChoiceError] = useState<string | null>(null);
  const [choosingMenuItemIndex, setChoosingMenuItemIndex] = useState<number | null>(null);
  const [menuChoiceError, setMenuChoiceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const searchRequestId = useRef(0);
  const { t } = useLocale();
  const warmState = useSearchPrewarm(open && tab === 'search');

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const pluginEditorContext = useMemo(() => pluginEditorCommandContextForPathname(pathname), [pathname]);
  const clearLeftPanelForFullPageRoute = useCallback(() => {
    window.dispatchEvent(new CustomEvent('mindos:open-panel', { detail: { panel: null } }));
  }, []);

  const applyPluginActionResult = useCallback((result: Awaited<ReturnType<typeof choosePluginModalSuggestion>>) => {
    const showedNotice = toastPluginActionNotices(result);
    const targetPath = firstPluginActionTargetPath(result);
    if (targetPath) {
      openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
      smoothPush(`/view/${encodePath(targetPath)}`);
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
  }, [router, smoothPush]);

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

  const submitModalText = useCallback(async (modal: PluginModalSnapshot, text: string) => {
    setSubmittingModalText(true);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await submitPluginModalText(modal.id, text, modal.interactionId);
      applyPluginActionResult(result);
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to submit plugin modal text');
    } finally {
      setSubmittingModalText(false);
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

  const actions: CommandAction[] = useMemo(() => {
    const builtInActions: CommandAction[] = [
      {
        id: 'settings',
        label: t.search.openSettings,
        icon: <Settings size={15} />,
        shortcut: '⌘,',
        execute: () => { onClose(); smoothPush('/settings'); },
      },
      {
        id: 'restart-walkthrough',
        label: t.search.restartWalkthrough,
        icon: <RotateCcw size={15} />,
        execute: () => {
          restartWalkthrough().then(() => {
            toast.success(t.search.walkthroughRestarted);
          }).catch(() => {
            toast.error('Failed to restart walkthrough');
          });
          onClose();
        },
      },
      {
        id: 'toggle-dark-mode',
        label: t.search.toggleDarkMode,
        icon: isDark ? <Sun size={15} /> : <Moon size={15} />,
        execute: () => {
          const html = document.documentElement;
          const nowDark = html.classList.contains('dark');
          html.classList.toggle('dark', !nowDark);
          try { localStorage.setItem('theme', nowDark ? 'light' : 'dark'); } catch { /* noop */ }
          onClose();
        },
      },
      {
        id: 'go-agents',
        label: t.search.goToAgents,
        icon: <Bot size={15} />,
        execute: () => { onClose(); smoothPush('/agents'); },
      },
      {
        id: 'go-studio',
        label: t.search.goToStudio ?? 'Go to Studio',
        icon: <Sparkles size={15} />,
        execute: () => {
          clearLeftPanelForFullPageRoute();
          onClose();
          smoothPush('/studio');
        },
      },
      {
        id: 'go-discover',
        label: t.search.goToDiscover,
        icon: <Compass size={15} />,
        execute: () => { onClose(); smoothPush('/explore'); },
      },
      {
        id: 'go-help',
        label: t.search.goToHelp,
        icon: <HelpCircle size={15} />,
        execute: () => { onClose(); smoothPush('/help'); },
      },
    ];

    const pluginActions: CommandAction[] = pluginCommands.map((surface) => ({
      id: surface.id,
      label: pluginCommandLabel(surface),
      icon: <Terminal size={15} />,
      shortcut: pluginCommandHotkeyLabel(surface) ?? undefined,
      shortcutPolicy: pluginCommandHotkeyPolicyLabel(surface) ?? undefined,
      shortcutTitle: pluginCommandHotkeyConflictSummary(surface) ?? undefined,
      execute: async () => {
        try {
          const result = await executePluginCommandSurface(surface, pluginEditorContext);
          const showedNotice = toastPluginActionNotices(result);
          const targetPath = firstPluginActionTargetPath(result);
          if (targetPath) {
            openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
            onClose();
            smoothPush(`/view/${encodePath(targetPath)}`);
            toast.success(`Opened ${targetPath}`);
          } else if (result.editorUpdates?.some((update) => update.changed)) {
            notifyFilesChanged(
              result.editorUpdates
                .flatMap((update) => update.changed && update.sourcePath ? [update.sourcePath] : []),
            );
            router.refresh();
            toast.success(`Updated ${result.editorUpdates[0]?.sourcePath ?? 'current note'}`);
            onClose();
          } else {
            const modal = firstPluginActionModalSnapshot(result);
            if (modal) {
              setPluginModal(modal);
              onClose();
            } else {
              const menu = firstPluginActionMenuSnapshot(result);
              if (menu) {
                setPluginMenu(menu);
                onClose();
              } else if (!showedNotice) {
                toast.success(`Ran ${surface.title}`);
                onClose();
              } else {
                onClose();
              }
            }
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to run plugin command');
        }
      },
    }));

    return [...builtInActions, ...pluginActions];
  }, [t, router, smoothPush, onClose, isDark, pluginCommands, pluginEditorContext, clearLeftPanelForFullPageRoute]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, pluginEditorContext]);

  // Focus input when modal opens; clean up debounce timer on close/unmount
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setLoading(false);
      setSelectedIndex(0);
      setTab('search');
      setActionIndex(0);
    }
    return () => {
      searchRequestId.current += 1;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      searchAbort.current?.abort();
    };
  }, [open]);

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

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
  }, [doSearch]);

  const clearSearch = useCallback(() => {
    setQuery('');
    doSearch('');
    inputRef.current?.focus();
  }, [doSearch]);

  const navigate = useCallback((result: SearchResult) => {
    onClose();
    smoothPush(`/view/${encodePath(result.path)}`);
  }, [smoothPush, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Tab') {
        // Tab switches between Search/Actions tabs
        e.preventDefault();
        setTab(prev => prev === 'search' ? 'actions' : 'search');
        setActionIndex(0);
        setSelectedIndex(0);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (tab === 'search') {
          setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        } else {
          setActionIndex(i => Math.min(i + 1, actions.length - 1));
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (tab === 'search') {
          setSelectedIndex(i => Math.max(i - 1, 0));
        } else {
          setActionIndex(i => Math.max(i - 1, 0));
        }
      } else if (e.key === 'Enter') {
        if (tab === 'search') {
          if (results[selectedIndex]) navigate(results[selectedIndex]);
        } else {
          if (actions[actionIndex]) actions[actionIndex].execute();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, results, selectedIndex, navigate, tab, actions, actionIndex]);

  useLayoutEffect(() => {
    if (tab === 'search') {
      const container = resultsRef.current;
      if (!container) return;
      const selected = container.children[selectedIndex] as HTMLElement | undefined;
      selected?.scrollIntoView({ block: 'nearest' });
    } else {
      const container = actionsRef.current;
      if (!container) return;
      const selected = container.children[actionIndex] as HTMLElement | undefined;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, actionIndex, tab]);

  if (!open && !pluginModal && !pluginMenu) return null;

  const warmHint = getSearchWarmHint(warmState, query, {
    preparing: t.search.preparing,
    fallbackWarmHint: t.search.fallbackWarmHint,
  });

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-app-modal flex items-end md:items-start justify-center md:pt-[15vh] modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full md:max-w-xl md:mx-4 bg-card border-t md:border border-border rounded-t-xl md:rounded-xl shadow-xl overflow-hidden max-h-[85vh] md:max-h-none flex flex-col">
        {/* Mobile drag indicator */}
        <div className="flex justify-center pt-2 pb-0 md:hidden">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-2 pb-0">
          <button
            onClick={() => {
              startTransition(() => {
                setTab('search');
                setTimeout(() => inputRef.current?.focus(), 50);
              });
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              tab === 'search'
                ? 'text-foreground border-b-2 border-[var(--amber)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.search.tabSearch}
          </button>
          <button
            onClick={() => {
              startTransition(() => {
                setTab('actions');
                setActionIndex(0);
              });
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              tab === 'actions'
                ? 'text-foreground border-b-2 border-[var(--amber)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.search.tabActions}
          </button>
        </div>

        {/* Search tab */}
        {tab === 'search' && (
          <>
            {/* Search input - IMPROVED */}
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <Search size={16} className="text-muted-foreground shrink-0 flex-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={handleChange}
                  placeholder={t.search.placeholder}
                  className="flex-1 bg-transparent text-foreground text-base font-medium placeholder:text-muted-foreground/60 outline-none"
                />
                {loading && (
                  <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin shrink-0 flex-none" />
                )}
                {query && (
                  <button
                    onClick={() => {
                      startTransition(() => {
                        clearSearch();
                      });
                    }}
                    className="shrink-0 flex-none p-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={t.search.clear}
                  >
                    <X size={16} />
                  </button>
                )}
                <kbd className="hidden md:inline text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5 font-mono">ESC</kbd>
              </div>
              {warmHint && (
                <p className="mt-2 text-xs text-muted-foreground/70">{warmHint}</p>
              )}
            </div>

            {/* Results */}
            <div ref={resultsRef} className="max-h-[50vh] md:max-h-80 overflow-y-auto flex-1">
              {/* Empty state */}
              {results.length === 0 && !query && !loading && (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
                    <Search size={20} className="text-muted-foreground/60" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">{t.search.emptyTitle}</h3>
                  <p className="text-xs text-muted-foreground/70">{t.search.emptyHint}</p>
                </div>
              )}

              {/* No results state */}
              {results.length === 0 && query && !loading && (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
                    <Search size={20} className="text-muted-foreground/60" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">{t.search.noResults}</h3>
                  <p className="text-xs text-muted-foreground/70">{t.search.noResultsHint}</p>
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

              {/* Results list - IMPROVED */}
              {results.map((result, i) => {
                const ext = result.path.endsWith('.csv') ? '.csv' : '.md';
                const { name, breadcrumb } = formatPath(result.path);
                const isSelected = i === selectedIndex;
                const isDragging = i === draggedIndex;

                return (
                  <button
                    key={result.path}
                    draggable
                    onDragStart={(e) => handleDragStart(e, result, i)}
                    onDragEnd={handleDragEnd}
                    onDragEnter={() => setDraggedIndex(i)}
                    onDragLeave={() => setDraggedIndex(null)}
                    onClick={() => navigate(result)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`
                      w-full px-3 py-2.5 flex items-start gap-3 text-left transition-colors duration-100
                      ${isSelected ? 'bg-[var(--amber-dim)] border-l-2 border-[var(--amber)]' : 'border-l-2 border-transparent'}
                      ${isDragging ? 'bg-muted/70' : isSelected ? '' : 'hover:bg-muted/60'}
                      ${i < results.length - 1 ? 'border-b border-border/50' : ''}
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
                          {highlightSearchSnippet(result.snippet, query)}
                        </p>
                      )}
                    </div>

                    {/* Drag hint for mobile/desktop */}
                    {isSelected && !isDragging && (
                      <div className="hidden md:flex shrink-0 flex-none text-[10px] text-muted-foreground/50 font-mono pt-0.5">
                        ⬆ Drag
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer — desktop only */}
            {results.length > 0 && (
              <div className="hidden md:flex px-4 py-2 border-t border-border/50 items-center gap-2 text-xs text-muted-foreground/60">
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↑↓</kbd> {t.search.navigate}</span>
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↵</kbd> {t.search.open}</span>
                <span className="text-muted-foreground/40 mx-0.5">•</span>
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">Drag</kbd> to chat</span>
                <span className="text-muted-foreground/40 mx-0.5">•</span>
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">ESC</kbd> {t.search.close}</span>
              </div>
            )}
          </>
        )}

        {/* Actions tab */}
        {tab === 'actions' && (
          <div ref={actionsRef} className="max-h-[50vh] md:max-h-80 overflow-y-auto flex-1 py-1">
            {actions.map((action, i) => (
              <button
                key={action.id}
                onClick={() => action.execute()}
                onMouseEnter={() => setActionIndex(i)}
                className={`
                  w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors duration-75
                  ${i === actionIndex ? 'bg-muted' : 'hover:bg-muted/50'}
                `}
              >
                <span className="text-muted-foreground shrink-0">{action.icon}</span>
                <span className="text-sm text-foreground flex-1">{action.label}</span>
                {action.shortcut && (
                  <span className="flex shrink-0 items-center gap-1.5" title={action.shortcutTitle}>
                    <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground/60">
                      {action.shortcut}
                    </kbd>
                    {action.shortcutPolicy === 'Conflict' && (
                      <span className="rounded border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-1.5 py-0.5 text-2xs font-medium text-[var(--amber-text)]">
                        Conflict
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
          </div>
        </div>
      )}

      <PluginActionModalDialog
        modal={pluginModal}
        onChooseSuggestion={(modal, suggestion) => void chooseModalSuggestion(modal, suggestion)}
        onSubmitText={(modal, text) => void submitModalText(modal, text)}
        choosingSuggestionIndex={choosingSuggestionIndex}
        submittingText={submittingModalText}
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
