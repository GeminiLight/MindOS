'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, ChevronDown, ChevronRight, Check, Loader2, Search, RefreshCw } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  type ProviderId,
  PROVIDER_PRESETS,
  ALL_PROVIDER_IDS,
  isProviderId,
  getApiKeyEnvVar,
} from '@/lib/agent/providers';
import { type CustomProvider, isCustomProviderId, findCustomProvider } from '@/lib/custom-endpoints';

const STORAGE_KEY = 'mindos-provider-model';

type ProviderSelection = ProviderId | `cp_${string}` | null;

interface ProviderModelCapsuleProps {
  providerValue: ProviderSelection;
  onProviderChange: (provider: ProviderSelection) => void;
  modelValue: string | null;
  onModelChange: (model: string | null) => void;
  disabled?: boolean;
}

interface SettingsData {
  ai?: {
    provider?: string;
    providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>;
  };
  customProviders?: CustomProvider[];
  envOverrides?: Record<string, boolean>;
}

/* ── Persistence ── */

export function getPersistedProviderModel(): { provider: ProviderSelection; model: string | null } {
  if (typeof window === 'undefined') return { provider: null, model: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const old = localStorage.getItem('mindos-provider-override');
      if (old && (isProviderId(old) || isCustomProviderId(old))) return { provider: old as any, model: null };
      return { provider: null, model: null };
    }
    const parsed = JSON.parse(raw);
    const provider = parsed?.provider && (isProviderId(parsed.provider) || isCustomProviderId(parsed.provider))
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

function getConfiguredProviders(data: SettingsData): (ProviderId | `cp_${string}`)[] {
  const result: (ProviderId | `cp_${string}`)[] = [];
  const providers = data.ai?.providers ?? {};
  const customProviders = data.customProviders ?? [];
  const env = data.envOverrides ?? {};
  for (const id of ALL_PROVIDER_IDS) {
    const preset = PROVIDER_PRESETS[id];
    const hasKey = providers[id]?.apiKey === '***set***';
    const envVar = getApiKeyEnvVar(id);
    const hasEnv = envVar ? !!env[envVar] : false;
    if (hasKey || hasEnv) { result.push(id); }
    else if (preset.apiKeyFallback) {
      const cfg = providers[id];
      if (data.ai?.provider === id || (cfg && (cfg.model || cfg.baseUrl))) result.push(id);
    }
  }
  for (const cp of customProviders) result.push(cp.id as `cp_${string}`);
  return result;
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
  const [hoveredProvider, setHoveredProvider] = useState<ProviderId | `cp_${string}` | null>(null);
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

  const defaultProvider = (settingsData?.ai?.provider && isProviderId(settingsData.ai.provider))
    ? settingsData.ai.provider as ProviderId : 'anthropic';

  const configuredProviders = useMemo(
    () => settingsData ? getConfiguredProviders(settingsData) : [],
    [settingsData],
  );

  // Auto-clear stale override
  useEffect(() => {
    if (!settingsData || !providerValue) return;
    if (!configuredProviders.includes(providerValue)) {
      onProviderChange(null); onModelChange(null);
      persistProviderModel(null, null);
    }
  }, [settingsData, providerValue, configuredProviders, onProviderChange, onModelChange]);

  // Resolve active display
  const activeProvider = providerValue ?? defaultProvider;
  const isCustomActive = isCustomProviderId(String(activeProvider));
  const customProvider = isCustomActive ? findCustomProvider(settingsData?.customProviders ?? [], String(activeProvider)) : null;
  const activePreset = !isCustomActive ? PROVIDER_PRESETS[activeProvider as ProviderId] : null;
  const defaultModel = customProvider?.model
    || settingsData?.ai?.providers?.[activeProvider as ProviderId]?.model
    || activePreset?.defaultModel || '';
  const displayModel = modelValue || defaultModel;
  const displayName = customProvider?.name
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
  const fetchModels = useCallback(async (providerId: ProviderId | `cp_${string}`, force = false) => {
    if (!force && modelsCacheRef.current[providerId]) {
      setExpandedModels(modelsCacheRef.current[providerId]);
      setModelsLoading(false);
      return;
    }
    if (force) delete modelsCacheRef.current[providerId];
    setModelsLoading(true); setModelsError(''); setExpandedModels(null);
    const version = ++fetchVersionRef.current;
    try {
      const isCustom = isCustomProviderId(String(providerId));
      const body: Record<string, string> = isCustom 
        ? { customProviderId: providerId }
        : { provider: providerId };
      
      const res = await fetch('/api/settings/list-models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  const canCustomProviderExpand = useCallback((cpId: string) => {
    if (!isCustomProviderId(cpId)) return false;
    const cp = findCustomProvider(settingsData?.customProviders ?? [], cpId);
    return !!cp; // All custom providers can now expand (they use their baseProviderId)
  }, [settingsData]);

  // Determine if a provider can show model flyout
  const canProviderExpand = useCallback((id: ProviderId | `cp_${string}`) => {
    if (isCustomProviderId(String(id))) {
      return canCustomProviderExpand(String(id));
    }
    return PROVIDER_PRESETS[id as ProviderId]?.supportsListModels ?? false;
  }, [canCustomProviderExpand]);

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
  const openFlyout = useCallback((providerId: ProviderId | `cp_${string}`) => {
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
    onProviderChange(provider); onModelChange(null);
    persistProviderModel(provider, null);
    setOpen(false); setHoveredProvider(null); setModelSearch('');
  }, [onProviderChange, onModelChange]);

  const handleSelectModel = useCallback((provider: ProviderSelection, model: string) => {
    onProviderChange(provider); onModelChange(model);
    persistProviderModel(provider, model);
    setOpen(false); setHoveredProvider(null); setModelSearch('');
  }, [onProviderChange, onModelChange]);

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
      e.preventDefault(); handleSelectModel(hoveredProvider, filteredModels[modelHighlight]);
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
  // For built-in providers, use shortLabel; for custom, truncate if too long
  const providerDisplay = isCustomProviderId(String(activeProvider))
    ? ((displayName || '').length > 12 ? (displayName || '').slice(0, 10) + '…' : displayName)
    : (activePreset?.shortLabel || displayName);
  const capsuleTooltip = `${displayName} · ${displayModel}`;
  const builtInIds = configuredProviders.filter(id => !isCustomProviderId(String(id)));
  const customIds = configuredProviders.filter(id => isCustomProviderId(String(id)));
  const hasModelOverride = !!(modelValue && modelValue !== defaultModel);

  /* ── Render: flyout (right panel) — positioned absolutely via portal ── */
  const renderFlyout = () => {
    if (!hoveredProvider) return null;
    const isCustom = isCustomProviderId(String(hoveredProvider));
    const preset = !isCustom ? PROVIDER_PRESETS[hoveredProvider as ProviderId] : null;
    const customProvider = isCustom ? findCustomProvider(settingsData?.customProviders ?? [], String(hoveredProvider)) : null;
    const displayName = customProvider?.name || (preset ? (locale === 'zh' ? preset.nameZh : preset.name) : String(hoveredProvider));
    
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
            const defModel = settingsData?.ai?.providers?.[hoveredProvider]?.model || preset?.defaultModel;
            return (
              <button
                key={m} type="button" data-model-item
                onClick={() => handleSelectModel(hoveredProvider, m)}
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
        {builtInIds.map((id) => {
          const preset = PROVIDER_PRESETS[id as ProviderId];
          const provName = locale === 'zh' ? preset.nameZh : preset.name;
          const provModel = modelValue && providerValue === id ? modelValue
            : settingsData?.ai?.providers?.[id as ProviderId]?.model || preset.defaultModel;
          const isSelected = providerValue === id || (!providerValue && defaultProvider === id);
          const isHovered = hoveredProvider === id;
          const canExpand = canProviderExpand(id as ProviderId);

          return (
            <div
              key={id}
              ref={isHovered ? hoveredRowRef : undefined}
              onMouseEnter={() => canExpand ? openFlyout(id as ProviderId) : closeFlyoutImmediate()}
              onMouseLeave={startCloseTimer}
            >
              <div className={`flex w-full items-center text-xs transition-colors ${isHovered ? 'bg-accent/60' : 'hover:bg-muted/60'}`}>
                <button
                  type="button" role="option" aria-selected={isSelected}
                  onClick={() => handleSelectProvider(id as ProviderId)}
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
                      else openFlyout(id as ProviderId);
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

        {customIds.map((id) => {
          const cp = findCustomProvider(settingsData?.customProviders ?? [], String(id));
          if (!cp) return null;
          const cpModel = modelValue && providerValue === id ? modelValue : cp.model;
          const isSelected = providerValue === id;
          const isHovered = hoveredProvider === id;
          const canExpand = canProviderExpand(id as `cp_${string}`);

          return (
            <div
              key={id}
              ref={isHovered ? hoveredRowRef : undefined}
              onMouseEnter={() => canExpand ? openFlyout(id as `cp_${string}`) : closeFlyoutImmediate()}
              onMouseLeave={startCloseTimer}
            >
              <div className={`flex w-full items-center text-xs transition-colors ${isHovered ? 'bg-accent/60' : 'hover:bg-muted/60'}`}>
                <button
                  type="button" role="option" aria-selected={isSelected}
                  onClick={() => handleSelectProvider(id)}
                  className="flex flex-1 items-center gap-2 px-3 py-1.5 min-w-0"
                >
                  <div className="flex-1 min-w-0 truncate">
                    <span className={`text-xs ${isSelected ? 'font-medium text-foreground' : 'text-foreground/80'}`}>
                      {cp.name}
                    </span>
                    <span className="text-2xs text-muted-foreground ml-1.5">{cpModel}</span>
                  </div>
                  {isSelected && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
                </button>
                {canExpand && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hoveredProvider === id) closeFlyoutImmediate();
                      else openFlyout(id as `cp_${string}`);
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
