'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, ChevronDown, ChevronRight, Check, Loader2, Search, RefreshCw } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  type ProviderId,
  PROVIDER_PRESETS,
  isProviderId,
} from '@/lib/agent/providers';
import { type Provider, isProviderEntryId, findProvider } from '@/lib/custom-endpoints';

const STORAGE_KEY = 'mindos-provider-model';

type ProviderSelection = ProviderId | `p_${string}` | null;

interface ProviderModelCapsuleProps {
  providerValue: ProviderSelection;
  onProviderChange: (provider: ProviderSelection) => void;
  modelValue: string | null;
  onModelChange: (model: string | null) => void;
  disabled?: boolean;
}

interface SettingsData {
  ai?: {
    activeProvider?: string;
    providers?: Provider[];
  };
  envOverrides?: Record<string, boolean>;
}

/* ── Persistence ── */

export function getPersistedProviderModel(): { provider: ProviderSelection; model: string | null } {
  if (typeof window === 'undefined') return { provider: null, model: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const old = localStorage.getItem('mindos-provider-override');
      if (old && (isProviderId(old) || isProviderEntryId(old))) return { provider: old as any, model: null };
      return { provider: null, model: null };
    }
    const parsed = JSON.parse(raw);
    const provider = parsed?.provider && (isProviderId(parsed.provider) || isProviderEntryId(parsed.provider))
      ? parsed.provider : null;
    const model = typeof parsed?.model === 'string' ? parsed.model : null;
    return { provider, model };
  } catch { return { provider: null, model: null }; }
}

function persistProviderModel(provider: ProviderSelection, model: string | null): void {
  try {
    if (provider || model) localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, model }));
    else localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('mindos-provider-override');
  } catch {}
}

/* ── Configured providers ── */

function getConfiguredProviders(data: SettingsData): string[] {
  return (data.ai?.providers ?? []).map(p => p.id);
}

/* ── Component ── */

export default function ProviderModelCapsule({
  providerValue, onProviderChange, modelValue, onModelChange, disabled = false,
}: ProviderModelCapsuleProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);

  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);

  // Flyout state
  const providerPanelRef = useRef<HTMLDivElement>(null);
  const hoveredRowRef = useRef<HTMLDivElement>(null);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>({});
  const [expandedModels, setExpandedModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [modelHighlight, setModelHighlight] = useState(-1);
  const fetchVersionRef = useRef(0);
  const modelsCacheRef = useRef<Record<string, string[]>>({});

  // Debounced flyout close — prevents flicker when mouse crosses gap
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = undefined; }
  }, []);

  const startCloseTimer = useCallback(() => {
    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setHoveredProvider(null);
      setModelSearch('');
    }, 300); // 300ms grace period to cross the gap smoothly
  }, [cancelCloseTimer]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (repositionTimerRef.current) clearTimeout(repositionTimerRef.current);
  }, []);

  // Fetch settings
  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      fetch('/api/settings', { cache: 'no-store' })
        .then(r => r.json())
        .then((d: SettingsData) => { if (!cancelled) setSettingsData(d); })
        .catch(() => {});
    };
    doFetch();
    const onVisible = () => { if (document.visibilityState === 'visible') doFetch(); };
    const onChange = () => doFetch();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('mindos:settings-changed', onChange);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('mindos:settings-changed', onChange); };
  }, []);

  const defaultProvider = settingsData?.ai?.activeProvider || '';

  const configuredProviders = useMemo(
    () => settingsData ? getConfiguredProviders(settingsData) : [],
    [settingsData],
  );

  // Stable refs for callbacks — avoids stale closures in effects and handlers
  const onProviderChangeRef = useRef(onProviderChange);
  onProviderChangeRef.current = onProviderChange;
  const onModelChangeRef = useRef(onModelChange);
  onModelChangeRef.current = onModelChange;

  // Auto-clear stale override — only if the persisted provider no longer exists in settings.
  // Use a one-time check on settingsData load, not on every providerValue change,
  // to avoid interfering with in-flight selections.
  const staleClearedRef = useRef(false);
  useEffect(() => {
    if (!settingsData || staleClearedRef.current) return;
    staleClearedRef.current = true;
    if (providerValue && !configuredProviders.includes(providerValue)) {
      onProviderChangeRef.current(null);
      onModelChangeRef.current(null);
      persistProviderModel(null, null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsData]);

  // Resolve active display
  const activeProvider = providerValue ?? defaultProvider;
  const activeEntry = findProvider(settingsData?.ai?.providers ?? [], String(activeProvider));
  const activePreset = activeEntry ? PROVIDER_PRESETS[activeEntry.protocol] : null;
  const defaultModel = activeEntry?.model
    || activePreset?.defaultModel || '';
  const displayModel = modelValue || defaultModel;
  const displayName = activeEntry?.name
    || (activePreset ? (locale === 'zh' ? activePreset.nameZh : activePreset.name) : String(activeProvider));

  /* ── Dropdown positioning ── */
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const repositionTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const goUp = rect.top > window.innerHeight - rect.bottom && rect.top > 280;
    setDropdownStyle({
      position: 'fixed',
      left: Math.min(rect.left, window.innerWidth - 230),
      ...(goUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      zIndex: 50,
    });
  }, []);

  // Debounce repositioning to prevent jank from rapid mouse events
  const debouncedReposition = useCallback(() => {
    if (repositionTimerRef.current) clearTimeout(repositionTimerRef.current);
    repositionTimerRef.current = setTimeout(() => {
      reposition();
    }, 0); // Use requestAnimationFrame-like timing
  }, [reposition]);

  useEffect(() => { if (open) reposition(); }, [open, reposition]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', debouncedReposition, true);
    window.addEventListener('resize', debouncedReposition);
    return () => { 
      window.removeEventListener('scroll', debouncedReposition, true); 
      window.removeEventListener('resize', debouncedReposition); 
      if (repositionTimerRef.current) clearTimeout(repositionTimerRef.current);
    };
  }, [open, debouncedReposition]);

  // Close on outside click — check trigger, provider panel, and flyout
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (containerRef.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      setOpen(false); setHoveredProvider(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hoveredProvider) { setHoveredProvider(null); setModelSearch(''); }
        else setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, hoveredProvider]);

  /* ── Model fetching ── */
  const fetchModels = useCallback(async (providerId: string, force = false) => {
    if (!force && modelsCacheRef.current[providerId]) {
      setExpandedModels(modelsCacheRef.current[providerId]);
      setModelsLoading(false);
      return;
    }
    if (force) delete modelsCacheRef.current[providerId];
    setModelsLoading(true); setModelsError(''); setExpandedModels(null);
    const version = ++fetchVersionRef.current;
    try {
      const res = await fetch('/api/settings/list-models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      if (version !== fetchVersionRef.current) return;
      const json = await res.json();
      if (version !== fetchVersionRef.current) return;
      if (json.ok && Array.isArray(json.models)) {
        modelsCacheRef.current[providerId] = json.models;
        setExpandedModels(json.models);
      } else { setModelsError(json.error || 'Failed'); }
    } catch {
      if (version === fetchVersionRef.current) setModelsError('Network error');
    } finally {
      if (version === fetchVersionRef.current) setModelsLoading(false);
    }
  }, []);

  // Determine if a provider can show model flyout
  const canProviderExpand = useCallback((id: string) => {
    const entry = findProvider(settingsData?.ai?.providers ?? [], id);
    if (!entry) return false;
    const preset = PROVIDER_PRESETS[entry.protocol];
    return preset?.supportsListModels ?? false;
  }, [settingsData]);

  // Compute flyout position: anchored to right edge of provider panel, aligned to hovered row
  const computeFlyoutPosition = useCallback(() => {
    const panel = providerPanelRef.current;
    const row = hoveredRowRef.current;
    if (!panel || !row) return;
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const flyoutWidth = 220;
    const flyoutMaxH = 320; // approx max height of flyout
    const gap = 4;
    const left = panelRect.right + gap;
    // Align top to the hovered row by default
    let top = rowRect.top;
    // If flyout would overflow below viewport, shift upward
    const spaceBelow = window.innerHeight - top;
    if (spaceBelow < flyoutMaxH) {
      // Align bottom of flyout to bottom of row instead
      top = Math.max(8, rowRect.bottom - flyoutMaxH);
    }
    // If flyout would overflow right edge, flip to left side
    const actualLeft = left + flyoutWidth > window.innerWidth - 8
      ? panelRect.left - flyoutWidth - gap
      : left;
    setFlyoutStyle({
      position: 'fixed',
      left: actualLeft,
      top,
      zIndex: 51,
    });
  }, []);

  // Open flyout for a provider (debounced to prevent flicker)
  const openFlyout = useCallback((providerId: string) => {
    cancelCloseTimer();
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      if (!canProviderExpand(providerId)) {
        setHoveredProvider(null); setModelSearch('');
        return;
      }
      setHoveredProvider(providerId);
      setModelSearch(''); setModelHighlight(-1); setModelsError('');
      setExpandedModels(modelsCacheRef.current[providerId] ?? null);
      if (!modelsCacheRef.current[providerId]) fetchModels(providerId);
      // Position flyout after state update
      requestAnimationFrame(() => {
        computeFlyoutPosition();
        setTimeout(() => searchInputRef.current?.focus(), 50);
      });
    }, 80);
  }, [cancelCloseTimer, fetchModels, computeFlyoutPosition, canProviderExpand]);

  // Close flyout for non-expandable items (immediate, no debounce)
  const closeFlyoutImmediate = useCallback(() => {
    cancelCloseTimer();
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = undefined; }
    setHoveredProvider(null); setModelSearch('');
  }, [cancelCloseTimer]);

  /* ── Selection handlers ── */
  const handleSelectProvider = useCallback((provider: ProviderSelection) => {
    onProviderChangeRef.current(provider);
    onModelChangeRef.current(null);
    persistProviderModel(provider, null);
    setOpen(false); setHoveredProvider(null); setModelSearch('');
  }, []);

  const handleSelectModel = useCallback((provider: ProviderSelection, model: string) => {
    onProviderChangeRef.current(provider);
    onModelChangeRef.current(model);
    persistProviderModel(provider, model);
    setOpen(false); setHoveredProvider(null); setModelSearch('');
  }, []);

  /* ── Filtered models ── */
  const filteredModels = useMemo(() => {
    if (!expandedModels) return [];
    if (!modelSearch.trim()) return expandedModels;
    const q = modelSearch.toLowerCase();
    return expandedModels.filter(m => m.toLowerCase().includes(q));
  }, [expandedModels, modelSearch]);

  useEffect(() => { setModelHighlight(-1); }, [filteredModels]);

  const handleModelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!filteredModels.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setModelHighlight(i => (i + 1) % filteredModels.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setModelHighlight(i => (i - 1 + filteredModels.length) % filteredModels.length); }
    else if (e.key === 'Enter' && modelHighlight >= 0 && modelHighlight < filteredModels.length && hoveredProvider) {
      e.preventDefault(); handleSelectModel(hoveredProvider as ProviderSelection, filteredModels[modelHighlight]);
    } else if (e.key === 'Escape') { e.preventDefault(); setHoveredProvider(null); setModelSearch(''); }
  }, [filteredModels, modelHighlight, hoveredProvider, handleSelectModel]);

  useEffect(() => {
    if (modelHighlight < 0 || !modelListRef.current) return;
    const items = modelListRef.current.querySelectorAll('[data-model-item]');
    items[modelHighlight]?.scrollIntoView({ block: 'nearest' });
  }, [modelHighlight]);

  /* ── Guards ── */
  if (!settingsData || configuredProviders.length === 0) return null;

  const modelShort = (displayModel || '').length > 20
    ? (displayModel || '').slice(0, 18) + '…' : displayModel;
  // Capsule shows the user-given provider name, truncated if too long.
  // Only falls back to protocol shortLabel if the provider has no custom name.
  const providerDisplay = (() => {
    const name = activeEntry?.name || '';
    if (name && name.length > 12) return name.slice(0, 10) + '…';
    if (name) return name;
    return activePreset?.shortLabel || displayName;
  })();
  const capsuleTooltip = `${displayName} · ${displayModel}`;
  const providerIds = configuredProviders;
  const hasModelOverride = !!(modelValue && modelValue !== defaultModel);

  /* ── Render: flyout (right panel) — positioned absolutely via portal ── */
  const renderFlyout = () => {
    if (!hoveredProvider) return null;
    const hovEntry = findProvider(settingsData?.ai?.providers ?? [], hoveredProvider);
    const preset = hovEntry ? PROVIDER_PRESETS[hovEntry.protocol] : null;
    const displayName = hovEntry?.name || (preset ? (locale === 'zh' ? preset.nameZh : preset.name) : String(hoveredProvider));
    
    return createPortal(
      <div
        ref={flyoutRef}
        style={flyoutStyle}
        className="w-[220px] rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
        onMouseEnter={cancelCloseTimer}
        onMouseLeave={startCloseTimer}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
          <span className="text-2xs font-medium text-muted-foreground">
            {displayName}
          </span>
          <button
            type="button"
            onClick={() => fetchModels(hoveredProvider, true)}
            disabled={modelsLoading}
            className="p-1 text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-30"
            title="Refresh"
          >
            <RefreshCw size={10} className={modelsLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {/* Search */}
        <div className="px-2 pt-1.5 pb-1">
          <div className="relative">
            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
            <input
              ref={searchInputRef}
              type="text"
              value={modelSearch}
              onChange={e => setModelSearch(e.target.value)}
              onKeyDown={handleModelKeyDown}
              placeholder={t.ask?.searchModels ?? 'Search...'}
              className="w-full text-2xs pl-6 pr-2 py-1 rounded border border-border/50 bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[var(--amber)]/50"
              autoComplete="off"
            />
          </div>
        </div>
        {/* List */}
        <div ref={modelListRef} className="max-h-[240px] overflow-y-auto px-1 pb-1">
          {modelsLoading && !expandedModels && (
            <div className="flex items-center gap-1.5 px-2 py-3 text-2xs text-muted-foreground justify-center">
              <Loader2 size={10} className="animate-spin" />
              {t.ask?.loadingModels ?? 'Loading...'}
            </div>
          )}
          {modelsError && !modelsLoading && (
            <div className="px-2 py-3 text-2xs text-destructive text-center">{modelsError}</div>
          )}
          {!modelsLoading && !modelsError && filteredModels.length === 0 && expandedModels !== null && (
            <div className="px-2 py-3 text-2xs text-muted-foreground text-center">
              {modelSearch ? 'No matches' : 'No models'}
            </div>
          )}
          {filteredModels.map((m, i) => {
            const isModelSelected = providerValue === hoveredProvider && modelValue === m;
            const defModel = hovEntry?.model || preset?.defaultModel;
            return (
              <button
                key={m} type="button" data-model-item
                onClick={() => handleSelectModel(hoveredProvider as ProviderSelection, m)}
                className={`w-full text-left px-2 py-1 text-2xs rounded transition-colors flex items-center gap-1 ${
                  isModelSelected ? 'bg-[var(--amber)]/12 text-foreground font-medium'
                  : i === modelHighlight ? 'bg-accent' : 'hover:bg-accent/60'
                }`}
              >
                {isModelSelected
                  ? <Check size={9} className="shrink-0 text-[var(--amber)]" />
                  : <span className="w-[9px] shrink-0" />}
                <span className="truncate">{m}</span>
                {m === defModel && !isModelSelected && (
                  <span className="ml-auto text-[9px] text-muted-foreground/30 shrink-0">default</span>
                )}
              </button>
            );
          })}
        </div>
      </div>,
      document.body,
    );
  };

  /* ── Render: dropdown ── */
  const dropdown = open ? (
    <div
      ref={containerRef}
      style={dropdownStyle}
    >
      {/* Provider list (sole child — never moves) */}
      <div
        ref={providerPanelRef}
        role="listbox"
        aria-label={t.ask?.providerCapsule ?? 'Provider'}
        className="w-[220px] rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
        style={{ maxHeight: '70vh', overflowY: 'auto' }}
      >
        {providerIds.map((id) => {
          const entry = findProvider(settingsData?.ai?.providers ?? [], id);
          if (!entry) return null;
          const preset = PROVIDER_PRESETS[entry.protocol];
          const provName = entry.name || (locale === 'zh' ? preset?.nameZh : preset?.name) || id;
          const provModel = modelValue && providerValue === id ? modelValue
            : entry.model || preset?.defaultModel || '';
          const isSelected = providerValue === id || (!providerValue && defaultProvider === id);
          const isHovered = hoveredProvider === id;
          const canExpand = canProviderExpand(id);

          return (
            <div
              key={id}
              ref={isHovered ? hoveredRowRef : undefined}
              onMouseEnter={() => canExpand ? openFlyout(id) : closeFlyoutImmediate()}
              onMouseLeave={startCloseTimer}
            >
              <div className={`flex w-full items-center text-xs transition-colors ${isHovered ? 'bg-accent/60' : 'hover:bg-muted/60'}`}>
                <button
                  type="button" role="option" aria-selected={isSelected}
                  onClick={() => handleSelectProvider(id as ProviderSelection)}
                  className="flex flex-1 items-center gap-2 px-3 py-1.5 min-w-0"
                >
                  <div className="flex-1 min-w-0 truncate">
                    <span className={`text-xs ${isSelected ? 'font-medium text-foreground' : 'text-foreground/80'}`}>
                      {provName}
                    </span>
                    <span className="text-2xs text-muted-foreground ml-1.5">{provModel}</span>
                  </div>
                  {isSelected && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
                </button>
                {canExpand && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hoveredProvider === id) closeFlyoutImmediate();
                      else openFlyout(id);
                    }}
                    className={`shrink-0 px-1.5 py-1.5 mr-1 rounded transition-colors ${
                      isHovered ? 'text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground'
                    }`}
                    title={t.ask?.selectModel ?? 'Select model'}
                  >
                    <ChevronRight size={11} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  /* ── Capsule button ── */
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(v => !v);
          if (open) { setHoveredProvider(null); setModelSearch(''); }
        }}
        disabled={disabled}
        className={`
          inline-flex items-center gap-1 rounded-full px-2.5 py-0.5
          text-2xs font-medium transition-colors select-none max-w-[260px]
          border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          disabled:opacity-40 disabled:cursor-not-allowed
          ${providerValue || hasModelOverride
            ? 'bg-[var(--amber)]/10 border-[var(--amber)]/25 text-foreground hover:bg-[var(--amber)]/15'
            : 'bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
          }
        `}
        title={capsuleTooltip}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Cpu size={11} className="shrink-0" />
        <span className="truncate">
          {providerDisplay}
          <span className="text-muted-foreground"> · </span>
          <span className={hasModelOverride ? 'text-[var(--amber)]' : 'text-muted-foreground'}>{modelShort}</span>
        </span>
        <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
      </button>
      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
      {typeof document !== 'undefined' && open && renderFlyout()}
    </>
  );
}
