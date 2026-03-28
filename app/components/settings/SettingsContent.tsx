'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Settings, Loader2, AlertCircle, CheckCircle2, RotateCcw, Sparkles, Palette, Database, RefreshCw, Plug, Download, X, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { apiFetch } from '@/lib/api';
import type { AiSettings, AgentSettings, SettingsData, Tab } from './types';
import { AiTab } from './AiTab';
import { AppearanceTab } from './AppearanceTab';
import { KnowledgeTab } from './KnowledgeTab';
import { SyncTab } from './SyncTab';
import { McpTab } from './McpTab';
import { UpdateTab } from './UpdateTab';
import { UninstallTab } from './UninstallTab';

interface SettingsContentProps {
  visible: boolean;
  initialTab?: Tab;
  variant: 'modal' | 'panel';
  onClose?: () => void;
}

export default function SettingsContent({ visible, initialTab, variant, onClose }: SettingsContentProps) {
  const [tab, setTab] = useState<Tab>('ai');
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'load-error'>('idle');
  const { t, locale, setLocale } = useLocale();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dataLoaded = useRef(false);

  const [font, setFont] = useState('lora');
  const [contentWidth, setContentWidth] = useState('780px');
  const [dark, setDark] = useState(true);

  // Update available badge on Update tab
  const [hasUpdate, setHasUpdate] = useState(() => {
    if (typeof window === 'undefined') return false;
    const dismissed = localStorage.getItem('mindos_update_dismissed');
    const latest = localStorage.getItem('mindos_update_latest');
    return !!latest && latest !== dismissed;
  });
  useEffect(() => {
    const onAvail = () => setHasUpdate(true);
    const onDismiss = () => setHasUpdate(false);
    window.addEventListener('mindos:update-available', onAvail);
    window.addEventListener('mindos:update-dismissed', onDismiss);
    return () => {
      window.removeEventListener('mindos:update-available', onAvail);
      window.removeEventListener('mindos:update-dismissed', onDismiss);
    };
  }, []);

  const isPanel = variant === 'panel';

  // Init data when becoming visible
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    const justOpened = isPanel
      ? (visible && !prevVisibleRef.current)
      : visible;

    if (justOpened) {
      apiFetch<SettingsData>('/api/settings').then(d => { setData(d); dataLoaded.current = true; }).catch(() => setStatus('load-error'));
      setFont(localStorage.getItem('prose-font') ?? 'lora');
      setContentWidth(localStorage.getItem('content-width') ?? '780px');
      const stored = localStorage.getItem('theme');
      setDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
      setStatus('idle');
    }
    if (!visible) { dataLoaded.current = false; }
    prevVisibleRef.current = visible;
  }, [visible, isPanel]);

  useEffect(() => {
    if (visible && initialTab) setTab(initialTab);
  }, [visible, initialTab]);

  useEffect(() => {
    const fontMap: Record<string, string> = {
      'lora': "'Lora', Georgia, serif",
      'ibm-plex-sans': "'IBM Plex Sans', sans-serif",
      'geist': 'var(--font-geist-sans), sans-serif',
      'ibm-plex-mono': "'IBM Plex Mono', monospace",
    };
    document.documentElement.style.setProperty('--prose-font-override', fontMap[font] ?? '');
    localStorage.setItem('prose-font', font);
  }, [font]);

  useEffect(() => {
    document.documentElement.style.setProperty('--content-width-override', contentWidth);
    localStorage.setItem('content-width', contentWidth);
  }, [contentWidth]);

  // Esc to close — modal only
  useEffect(() => {
    if (variant !== 'modal' || !visible || !onClose) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, visible, onClose]);

  const doSave = useCallback(async (d: SettingsData) => {
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: d.ai, agent: d.agent, mindRoot: d.mindRoot, webPassword: d.webPassword, authToken: d.authToken }),
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!data || !dataLoaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(data), 800);
    return () => clearTimeout(saveTimer.current);
  }, [data, doSave]);

  const updateAi = useCallback((patch: Partial<AiSettings>) => {
    setData(d => d ? { ...d, ai: { ...d.ai, ...patch } } : d);
  }, []);

  const updateAgent = useCallback((patch: Partial<AgentSettings>) => {
    setData(d => d ? { ...d, agent: { ...(d.agent ?? {}), ...patch } } : d);
  }, []);

  const restoreFromEnv = useCallback(async () => {
    if (!data) return;
    const defaults: AiSettings = {
      provider: 'anthropic',
      providers: { anthropic: { apiKey: '', model: '' }, openai: { apiKey: '', model: '', baseUrl: '' } },
    };
    setData(d => d ? { ...d, ai: defaults } : d);
    const DEBOUNCE_DELAY = 800;
    const SAVE_OPERATION_TIME = 500;
    setTimeout(() => {
      apiFetch<SettingsData>('/api/settings').then(d => { setData(d); }).catch(() => setStatus('error'));
    }, DEBOUNCE_DELAY + SAVE_OPERATION_TIME);
  }, [data]);

  const env = data?.envOverrides ?? {};
  const iconSize = isPanel ? 12 : 13;

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: boolean }[] = [
    { id: 'ai', label: t.settings.tabs.ai, icon: <Sparkles size={iconSize} /> },
    { id: 'mcp', label: t.settings.tabs.mcp ?? 'MCP & Skills', icon: <Plug size={iconSize} /> },
    { id: 'knowledge', label: t.settings.tabs.knowledge, icon: <Settings size={iconSize} /> },
    { id: 'appearance', label: t.settings.tabs.appearance, icon: <Palette size={iconSize} /> },
    { id: 'sync', label: t.settings.tabs.sync ?? 'Sync', icon: <RefreshCw size={iconSize} /> },
    { id: 'update', label: t.settings.tabs.update ?? 'Update', icon: <Download size={iconSize} />, badge: hasUpdate },
    { id: 'uninstall', label: t.settings.tabs.uninstall ?? 'Uninstall', icon: <Trash2 size={iconSize} /> },
  ];

  const activeTabLabel = TABS.find(t2 => t2.id === tab)?.label ?? '';

  /* ── Shared content & footer ── */
  const renderContent = () => (
    <div className={`flex-1 overflow-y-auto min-h-0 ${isPanel ? 'px-4 py-4 space-y-4' : 'px-5 py-5 space-y-5'}`}>
      {status === 'load-error' && (tab === 'ai' || tab === 'knowledge') ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <AlertCircle size={isPanel ? 18 : 20} className="text-destructive" />
          <p className={`${isPanel ? 'text-xs' : 'text-sm'} text-destructive font-medium`}>Failed to load settings</p>
          {!isPanel && <p className="text-xs text-muted-foreground">Check that the server is running and AUTH_TOKEN is configured correctly.</p>}
        </div>
      ) : !data && tab !== 'appearance' && tab !== 'mcp' && tab !== 'sync' && tab !== 'update' && tab !== 'uninstall' ? (
        <div className="flex justify-center py-8">
          <Loader2 size={isPanel ? 16 : 18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {tab === 'ai' && data?.ai && <AiTab data={data} updateAi={updateAi} updateAgent={updateAgent} t={t} />}
          {tab === 'appearance' && <AppearanceTab font={font} setFont={setFont} contentWidth={contentWidth} setContentWidth={setContentWidth} dark={dark} setDark={setDark} locale={locale} setLocale={setLocale} t={t} />}
          {tab === 'knowledge' && data && <KnowledgeTab data={data} setData={setData} t={t} />}
          {tab === 'sync' && <SyncTab t={t} />}
          {tab === 'mcp' && <McpTab t={t} />}
          {tab === 'update' && <UpdateTab />}
          {tab === 'uninstall' && <UninstallTab />}
        </>
      )}
    </div>
  );

  const renderFooter = () => (
    (tab === 'ai' || tab === 'knowledge') ? (
      <div className={`${isPanel ? 'px-4 py-2' : 'px-5 py-2.5'} border-t border-border shrink-0 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          {tab === 'ai' && Object.values(env).some(Boolean) && (
            <button
              onClick={restoreFromEnv}
              disabled={saving || !data}
              className={`flex items-center gap-1.5 ${isPanel ? 'px-2.5 py-1 text-[11px] rounded-md' : 'px-3 py-1 text-xs rounded-lg'} border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
            >
              <RotateCcw size={isPanel ? 11 : 12} />
              {t.settings.ai.restoreFromEnv}
            </button>
          )}
          {tab === 'knowledge' && (
            <a
              href="/setup?force=1"
              className={`flex items-center gap-1.5 ${isPanel ? 'px-2.5 py-1 text-[11px] rounded-md' : 'px-3 py-1 text-xs rounded-lg'} border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors`}
            >
              <RotateCcw size={isPanel ? 11 : 12} />
              {t.settings.reconfigure}
            </a>
          )}
        </div>
        {!isPanel && (
          <div className="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
            {saving && <><Loader2 size={12} className="animate-spin text-muted-foreground" /><span className="text-muted-foreground">{t.settings.save}...</span></>}
            {status === 'saved' && <><CheckCircle2 size={12} className="text-success" /><span className="text-success">{t.settings.saved}</span></>}
            {status === 'error' && <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">{t.settings.saveFailed}</span></>}
          </div>
        )}
      </div>
    ) : null
  );

  /* ── Panel variant: unchanged (horizontal tabs) ── */
  if (isPanel) {
    return (
      <>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-display">Settings</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 text-[10px]" role="status" aria-live="polite">
              {saving && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
              {status === 'saved' && <CheckCircle2 size={10} className="text-success" />}
              {status === 'error' && <AlertCircle size={10} className="text-destructive" />}
            </div>
          </div>
        </div>
        <div className="flex border-b border-border px-3 shrink-0 overflow-x-auto scrollbar-none gap-0">
          {TABS.map(tabItem => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`flex items-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
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
        </div>
        {renderContent()}
        {renderFooter()}
      </>
    );
  }

  /* ── Modal variant ── */
  return (
    <>
      {/* Mobile: original vertical layout */}
      <div className="flex flex-col h-full md:hidden">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex justify-center pt-2 pb-0 absolute top-0 left-1/2 -translate-x-1/2">
            <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings size={15} className="text-muted-foreground" />
            <span className="font-display">{t.settings.title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 text-[10px]" role="status" aria-live="polite">
              {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
              {status === 'saved' && <><CheckCircle2 size={12} className="text-success" /><span className="text-success">{t.settings.saved}</span></>}
              {status === 'error' && <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">{t.settings.saveFailed}</span></>}
            </div>
            {onClose && (
              <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        {/* Mobile horizontal tabs */}
        <div className="flex border-b border-border px-4 shrink-0 overflow-x-auto scrollbar-none gap-0">
          {TABS.map(tabItem => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
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
        </div>
        {renderContent()}
        {renderFooter()}
      </div>

      {/* Desktop: left-right layout */}
      <div className="hidden md:flex flex-row h-full min-h-0">
        {/* Left sidebar — vertical tabs */}
        <div className="w-[180px] shrink-0 border-r border-border flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Settings size={15} className="text-muted-foreground" />
            <span className="text-sm font-medium font-display text-foreground">{t.settings.title}</span>
          </div>
          <nav className="flex-1 overflow-y-auto py-1.5">
            {TABS.map(tabItem => (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id)}
                className={`flex items-center gap-2 w-full px-4 py-2 text-xs font-medium transition-colors relative ${
                  tab === tabItem.id
                    ? 'text-foreground bg-muted'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {tab === tabItem.id && (
                  <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-[var(--amber)]" />
                )}
                {tabItem.icon}
                {tabItem.label}
                {tabItem.badge && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-error shrink-0" />}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Right header: tab title + status + close */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <span className="text-sm font-medium text-foreground font-display">{activeTabLabel}</span>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 text-[10px]" role="status" aria-live="polite">
                {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                {status === 'saved' && <><CheckCircle2 size={12} className="text-success" /><span className="text-success">{t.settings.saved}</span></>}
                {status === 'error' && <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">{t.settings.saveFailed}</span></>}
              </div>
              {onClose && (
                <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
          {renderContent()}
          {renderFooter()}
        </div>
      </div>
    </>
  );
}
