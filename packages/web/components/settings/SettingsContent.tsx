'use client';

import { useEffect, useState, useCallback, useRef, type SetStateAction } from 'react';
import { Settings, Loader2, AlertCircle, CheckCircle2, RotateCcw, Sparkles, Palette, RefreshCw, Plug, Download, X, Trash2, HelpCircle, Puzzle, Compass } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { apiFetch } from '@/lib/api';
import type { AiSettings, AgentSettings, PluginPanel, SettingsData, Tab } from './types';
import { AiTab } from './AiTab';
import { AppearanceTab } from './AppearanceTab';
import { KnowledgeTab } from './KnowledgeTab';
import { NavigationTab } from './NavigationTab';
import { SyncTab } from './SyncTab';
import { McpTab } from './McpTab';
import { PluginsTab } from './PluginsTab';
import { UpdateTab } from './UpdateTab';
import { UninstallTab } from './UninstallTab';
import { restoreAiSettingsFromEnvironment } from './ai-env-restore';
import { settingsDraftStore } from './settings-draft';
import { useSettingsDraft } from './useSettingsDraft';
import { requestCommandCenterOpen, requestPluginEntriesOpen } from '@/lib/plugins/ui-events';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { MAIN_BODY_CONTENT_WIDTH_EVENT } from '@/lib/main-body-layout';

interface SettingsContentProps {
  visible: boolean;
  initialTab?: Tab;
  initialPluginPanel?: PluginPanel;
  variant: 'modal' | 'panel';
  onClose?: () => void;
  onOpenPluginEntries?: () => void;
  onOpenCommandCenter?: () => void;
}

function readStoredProseFont(storage: Storage): string {
  const stored = storage.getItem('prose-font');
  return stored && stored !== 'geist' ? stored : 'inter';
}

function migrateStoredContentWidth(raw: string): string {
  if (!raw.endsWith('px')) return raw;
  const px = parseInt(raw, 10);
  if (px >= 960) return '100%';
  if (px >= 780) return '80%';
  return '65%';
}

export default function SettingsContent({
  visible,
  initialTab,
  initialPluginPanel,
  variant,
  onClose,
  onOpenPluginEntries,
  onOpenCommandCenter,
}: SettingsContentProps) {
  const [tab, setTab] = useState<Tab>('ai');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const draft = useSettingsDraft();
  const data = draft.data;
  const saving = draft.status === 'saving';
  const setData = useCallback((action: SetStateAction<SettingsData | null>) => settingsDraftStore.update(action, tabRef.current), []);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'load-error'>('idle');
  const { t, locale, setLocale } = useLocale();
  const smoothPush = useSmoothRouterPush();
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const loadRequestId = useRef(0);
  const mountedRef = useRef(true);

  const showTransientStatus = useCallback((next: 'saved' | 'error') => {
    if (statusTimer.current) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
    setStatus(next);
    // An unsaved error is a persistent state, not a transient notification.
    if (next === 'error') return;
    statusTimer.current = setTimeout(() => {
      statusTimer.current = null;
      setStatus('idle');
    }, 2500);
  }, []);

  useEffect(() => {
    if (draft.status === 'saved' || draft.status === 'error') showTransientStatus(draft.status);
    else if (draft.status === 'pending' || draft.status === 'saving') setStatus('idle');
  }, [draft.status, showTransientStatus]);

  const [font, setFont] = useState('inter');
  const [fontSize, setFontSize] = useState('15px');
  const [contentWidth, setContentWidth] = useState('80%');
  const [dark, setDark] = useState(true);
  const [pluginStates, setPluginStates] = useState<Record<string, boolean>>({});

  // Update available badge on Update tab. Start false so SSR and client hydration match.
  const [hasUpdate, setHasUpdate] = useState(false);
  useEffect(() => {
    const syncStoredUpdate = () => {
      try {
        const dismissed = localStorage.getItem('mindos_update_dismissed');
        const latest = localStorage.getItem('mindos_update_latest');
        setHasUpdate(!!latest && latest !== dismissed);
      } catch {
        setHasUpdate(false);
      }
    };
    const onAvail = () => setHasUpdate(true);
    const onDismiss = () => setHasUpdate(false);
    syncStoredUpdate();
    window.addEventListener('mindos:update-available', onAvail);
    window.addEventListener('mindos:update-dismissed', onDismiss);
    return () => {
      window.removeEventListener('mindos:update-available', onAvail);
      window.removeEventListener('mindos:update-dismissed', onDismiss);
    };
  }, []);

  const isPanel = variant === 'panel';

  const loadSettings = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    const revision = settingsDraftStore.getSnapshot().revision;
    setStatus('idle');
    try {
      const loaded = await apiFetch<SettingsData>('/api/settings');
      if (requestId !== loadRequestId.current || !mountedRef.current) return;
      settingsDraftStore.acceptLoaded(loaded, revision);
    } catch {
      if (requestId === loadRequestId.current && mountedRef.current) setStatus('load-error');
    }
  }, []);

  // Init data when becoming visible
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    const justOpened = visible && !prevVisibleRef.current;

    if (justOpened) {
      if (!settingsDraftStore.getSnapshot().pending) {
        void loadSettings();
      }
      setFont(readStoredProseFont(localStorage));
      setFontSize(localStorage.getItem('prose-font-size') ?? '15px');
      setContentWidth(migrateStoredContentWidth(localStorage.getItem('content-width') ?? '80%'));
      const stored = localStorage.getItem('theme');
      setDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    if (!visible) {
      loadRequestId.current++;
    }
    prevVisibleRef.current = visible;
    return () => {
      loadRequestId.current++;
      // StrictMode replays mount effects; the replacement load must run too.
      prevVisibleRef.current = false;
    };
  }, [visible, loadSettings]);

  useEffect(() => {
    if (visible && initialTab) switchTab(initialTab);
  }, [visible, initialTab]);

  const switchTab = useCallback((id: Tab) => {
    setTab(id);
    contentRef.current?.scrollTo?.(0, 0);
  }, []);

  useEffect(() => {
    const fontMap: Record<string, string> = {
      'lora': "'Lora', Georgia, serif",
      'ibm-plex-sans': "'IBM Plex Sans', sans-serif",
      'inter': 'var(--font-inter), sans-serif',
      'ibm-plex-mono': "'IBM Plex Mono', monospace",
    };
    document.documentElement.style.setProperty('--prose-font-override', fontMap[font] ?? '');
    localStorage.setItem('prose-font', font);
  }, [font]);

  useEffect(() => {
    document.documentElement.style.setProperty('--prose-font-size-override', fontSize);
    localStorage.setItem('prose-font-size', fontSize);
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty('--content-width-override', contentWidth);
    localStorage.setItem('content-width', contentWidth);
    window.dispatchEvent(new CustomEvent(MAIN_BODY_CONTENT_WIDTH_EVENT, { detail: { value: contentWidth } }));
  }, [contentWidth]);

  const flushSave = useCallback(() => settingsDraftStore.flush(), []);

  // Flush unsaved changes when panel hides (panel variant)
  useEffect(() => {
    if (!visible) void flushSave();
  }, [visible, flushSave]);

  // The shared queue survives page unmounts; no fire-and-forget private payload is lost.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (statusTimer.current) clearTimeout(statusTimer.current);
      void settingsDraftStore.flush();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateAi = useCallback((patch: Partial<AiSettings>) => {
    setData(d => d ? { ...d, ai: { ...d.ai, ...patch } } : d);
  }, []);

  const updateAgent = useCallback((patch: Partial<AgentSettings>) => {
    setData(d => d ? { ...d, agent: { ...(d.agent ?? {}), ...patch } } : d);
  }, []);

  const openPluginEntries = useCallback(() => {
    if (onOpenPluginEntries) {
      onOpenPluginEntries();
      return;
    }
    onClose?.();
    window.requestAnimationFrame(requestPluginEntriesOpen);
  }, [onClose, onOpenPluginEntries]);

  const openCommandCenter = useCallback(() => {
    if (onOpenCommandCenter) {
      onOpenCommandCenter();
      return;
    }
    onClose?.();
    window.requestAnimationFrame(requestCommandCenterOpen);
  }, [onClose, onOpenCommandCenter]);

  const openPluginViews = useCallback(() => {
    onClose?.();
    smoothPush('/plugins/views');
  }, [onClose, smoothPush]);

  const restoreFromEnv = useCallback(async () => {
    if (!data) return;
    const next = { ...data, ai: restoreAiSettingsFromEnvironment(data) };
    setData(next);
    if (!await flushSave()) return;
    const revision = settingsDraftStore.getSnapshot().revision;
    setTimeout(() => {
      apiFetch<SettingsData>('/api/settings').then(d => {
        settingsDraftStore.acceptLoaded(d, revision);
      }).catch(() => { if (mountedRef.current) setStatus('load-error'); });
    }, 100);
  }, [data, flushSave]);

  const env = data?.envOverrides ?? {};
  const iconSize = isPanel ? 12 : 14;

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: boolean; group: 'core' | 'workspace' | 'system' }[] = [
    { id: 'ai', label: t.settings.tabs.ai, icon: <Sparkles size={iconSize} />, group: 'core' },
    { id: 'mcp', label: t.settings.tabs.mcp ?? 'Connections', icon: <Plug size={iconSize} />, group: 'core' },
    { id: 'plugins', label: t.settings.tabs.plugins ?? 'Plugins', icon: <Puzzle size={iconSize} />, group: 'core' },
    { id: 'knowledge', label: t.settings.tabs.knowledge, icon: <Settings size={iconSize} />, group: 'workspace' },
    { id: 'appearance', label: t.settings.tabs.appearance, icon: <Palette size={iconSize} />, group: 'workspace' },
    { id: 'sync', label: t.settings.tabs.sync ?? 'Sync', icon: <RefreshCw size={iconSize} />, group: 'workspace' },
    { id: 'navigation', label: t.settings.tabs.navigation ?? 'Experiments', icon: <Compass size={iconSize} />, group: 'workspace' },
    { id: 'update', label: t.settings.tabs.update ?? 'Update', icon: <Download size={iconSize} />, badge: hasUpdate, group: 'system' },
    { id: 'uninstall', label: t.settings.tabs.uninstall ?? 'Uninstall', icon: <Trash2 size={iconSize} />, group: 'system' },
  ];
  const TAB_GROUPS = [
    { id: 'core', label: locale === 'zh' ? '核心' : 'Core' },
    { id: 'workspace', label: locale === 'zh' ? '工作区' : 'Workspace' },
    { id: 'system', label: locale === 'zh' ? '系统' : 'System' },
  ] as const;

  const activeTabLabel = TABS.find(t2 => t2.id === tab)?.label ?? '';
  const desktopHeaderClass = 'h-12 border-b border-border/60 shrink-0 flex items-center bg-background/70';
  const renderInlineSaveStatus = (size: 'compact' | 'full' = 'full') => {
    const icon = size === 'compact' ? 11 : 12;
    return (
      <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs" role="status" aria-live="polite">
        {saving && <><Loader2 size={icon} className="animate-spin text-muted-foreground" />{size === 'full' && <span className="text-muted-foreground">{t.settings.save}...</span>}</>}
        {!saving && status === 'saved' && <><CheckCircle2 size={icon} className="text-success" /><span className="text-success">{t.settings.saved}</span></>}
        {!saving && status === 'error' && <>
          <AlertCircle size={icon} className="text-destructive" />
          <span className="text-destructive">{t.settings.saveFailed}</span>
          <button type="button" onClick={() => { void flushSave(); }}
            className="min-h-9 rounded-md px-2 text-foreground underline underline-offset-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t.settings.retrySave ?? 'Retry save'}
          </button>
        </>}
      </div>
    );
  };

  /* ── Shared content & footer ── */
  const renderContent = () => (
    <div ref={contentRef} className={`flex-1 overflow-y-auto min-h-0 ${isPanel ? 'px-4 py-4 space-y-4' : 'px-6 py-5 space-y-5'}`}>
      {status === 'load-error' && (tab === 'ai' || tab === 'knowledge' || tab === 'plugins') ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <AlertCircle size={isPanel ? 18 : 20} className="text-destructive" />
          <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-destructive font-medium`}>
            {t.settings.loadFailed ?? 'Failed to load settings'}
          </p>
          {!isPanel && (
            <p className="text-xs text-muted-foreground">
              {t.settings.loadFailedHint ?? 'Check that the server is running and AUTH_TOKEN is configured correctly.'}
            </p>
          )}
          <button type="button" onClick={() => void loadSettings()}
            className="min-h-10 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t.settings.retryLoad ?? 'Retry loading'}
          </button>
        </div>
      ) : !data && (tab === 'ai' || tab === 'knowledge' || tab === 'plugins') ? (
        <div className="flex justify-center py-8">
          <Loader2 size={isPanel ? 16 : 18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {tab === 'ai' && data?.ai && <AiTab data={data} setData={setData} updateAi={updateAi} updateAgent={updateAgent} t={t} />}
          {tab === 'appearance' && <AppearanceTab font={font} setFont={setFont} fontSize={fontSize} setFontSize={setFontSize} contentWidth={contentWidth} setContentWidth={setContentWidth} dark={dark} setDark={setDark} locale={locale} setLocale={setLocale} t={t} />}
          {tab === 'navigation' && <NavigationTab />}
          {tab === 'knowledge' && data && <KnowledgeTab data={data} setData={setData} t={t} />}
          {tab === 'sync' && <SyncTab t={t} visible={visible} />}
          {tab === 'mcp' && <McpTab t={t} />}
          {tab === 'plugins' && (
            <PluginsTab
              pluginStates={pluginStates}
              setPluginStates={setPluginStates}
              t={t}
              mindRoot={data?.mindRoot}
              initialPanel={initialPluginPanel}
              onOpenPluginEntries={openPluginEntries}
              onOpenCommandCenter={openCommandCenter}
              onOpenPluginViews={openPluginViews}
            />
          )}
          {tab === 'update' && <UpdateTab />}
          {tab === 'uninstall' && <UninstallTab />}
        </>
      )}
    </div>
  );

  const renderFooter = () => {
    const showAiRestore = tab === 'ai' && Object.values(env).some(Boolean);
    const showKnowledgeReconfigure = tab === 'knowledge';
    if (!showAiRestore && !showKnowledgeReconfigure) return null;

    return (
      <div className={`${isPanel ? 'px-4 py-2' : 'px-5 py-2.5'} border-t border-border shrink-0 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          {showAiRestore && (
            <button
              onClick={restoreFromEnv}
              disabled={saving || !data}
              className={`flex items-center gap-1.5 ${isPanel ? 'px-2.5 py-1 text-xs rounded-md' : 'px-3 py-1.5 text-sm rounded-lg'} border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <RotateCcw size={isPanel ? 12 : 13} />
              {t.settings.ai.restoreFromEnv}
            </button>
          )}
          {showKnowledgeReconfigure && (
            <a
              href="/setup?force=1"
              className={`flex items-center gap-1.5 ${isPanel ? 'px-2.5 py-1 text-xs rounded-md' : 'px-3 py-1.5 text-sm rounded-lg'} border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <RotateCcw size={isPanel ? 12 : 13} />
              {t.settings.reconfigure}
            </a>
          )}
        </div>
      </div>
    );
  };

  const renderHorizontalTabs = (mode: 'panel' | 'mobile') => {
    const isMobileTabs = mode === 'mobile';
    const buttonClassName = isMobileTabs
      ? 'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap'
      : 'flex items-center gap-1 px-2 py-2 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap';

    return (
      <div className={`flex border-b border-border ${isMobileTabs ? 'px-4' : 'px-3 shrink-0'} overflow-x-auto scrollbar-none gap-0`}>
        {TABS.map(tabItem => (
          <button
            key={tabItem.id}
            onClick={() => switchTab(tabItem.id)}
            className={`${buttonClassName} ${
              tab === tabItem.id
                ? 'border-[var(--amber)] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tabItem.icon}
            {tabItem.label}
            {tabItem.badge && <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />}
          </button>
        ))}
        {isMobileTabs && (
          <button
            onClick={() => { onClose?.(); smoothPush('/help'); }}
            className={`${buttonClassName} border-transparent text-muted-foreground hover:text-foreground`}
          >
            <HelpCircle size={iconSize} />
            {t.sidebar.help}
          </button>
        )}
      </div>
    );
  };

  /* ── Panel variant: unchanged (horizontal tabs) ── */
  if (isPanel) {
    return (
      <>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.settings.title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {renderInlineSaveStatus('compact')}
          </div>
        </div>
        {renderHorizontalTabs('panel')}
        {renderContent()}
        {renderFooter()}
      </>
    );
  }

  /* ── Modal variant ── */
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Mobile header + horizontal tabs */}
      <div className="shrink-0 md:hidden">
        <div className="relative flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="absolute top-2 left-1/2 -translate-x-1/2">
            <div className="h-1 w-8 rounded-full bg-muted-foreground/20" />
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings size={15} className="text-muted-foreground" />
            <span>{t.settings.title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {renderInlineSaveStatus('full')}
            {onClose && (
              <button type="button" aria-label={t.settings.closeSettings ?? 'Close settings'} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        {renderHorizontalTabs('mobile')}
      </div>

      {/* Desktop sidebar — vertical tabs */}
      <div className="hidden md:flex w-[232px] shrink-0 border-r border-border/60 bg-card/35 flex-col">
        <div className={`${desktopHeaderClass} gap-3 px-4`}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
            <Settings size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{t.settings.title}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-4">
            {TAB_GROUPS.map(group => {
              const items = TABS.filter(item => item.group === group.id);
              return (
                <div key={group.id} className="space-y-1">
                  <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground/70">
                    {group.label}
                  </div>
                  {items.map(tabItem => {
                    const active = tab === tabItem.id;
                    return (
                      <button
                        key={tabItem.id}
                        type="button"
                        onClick={() => switchTab(tabItem.id)}
                        className={`group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? 'bg-[var(--amber-subtle)] text-foreground ring-1 ring-[var(--amber)]/25'
                            : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'
                        }`}
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                          active
                            ? 'bg-[var(--amber)] text-[var(--amber-foreground)]'
                            : 'bg-background/60 text-muted-foreground group-hover:text-foreground'
                        }`}>
                          {tabItem.icon}
                        </span>
                        <span className="truncate">{tabItem.label}</span>
                        {tabItem.badge && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-error shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </nav>
        <div className="shrink-0 border-t border-border/60 p-3">
          <button
            onClick={() => { onClose?.(); smoothPush('/help'); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HelpCircle size={13} />
            {t.sidebar.help}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <div className={`${desktopHeaderClass} hidden md:flex justify-between px-6`}>
          <span className="text-sm font-semibold text-foreground">{activeTabLabel}</span>
          <div className="flex items-center gap-1.5">
            {renderInlineSaveStatus('full')}
            {onClose && (
              <button type="button" aria-label={t.settings.closeSettings ?? 'Close settings'} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        {renderContent()}
        {renderFooter()}
      </div>
    </div>
  );
}
