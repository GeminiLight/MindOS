'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Settings, Loader2, AlertCircle, CheckCircle2, RotateCcw, Sparkles, Palette, Database, RefreshCw, Plug, Puzzle, Activity, Users } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { getAllRenderers, loadDisabledState, isRendererEnabled } from '@/lib/renderers/registry';
import { apiFetch } from '@/lib/api';
import '@/lib/renderers/index';
import type { AiSettings, AgentSettings, SettingsData, Tab } from './settings/types';
import { FONTS } from './settings/types';
import { AiTab } from './settings/AiTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { KnowledgeTab } from './settings/KnowledgeTab';
import { PluginsTab } from './settings/PluginsTab';
import { SyncTab } from './settings/SyncTab';
import { McpTab } from './settings/McpTab';
import { MonitoringTab } from './settings/MonitoringTab';
import { AgentsTab } from './settings/AgentsTab';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
}

export default function SettingsModal({ open, onClose, initialTab }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('ai');
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'load-error'>('idle');
  const { t, locale, setLocale } = useLocale();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dataLoaded = useRef(false);

  // Appearance state (localStorage-based)
  const [font, setFont] = useState('lora');
  const [contentWidth, setContentWidth] = useState('780px');
  const [dark, setDark] = useState(true);
  // Plugin enabled state
  const [pluginStates, setPluginStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) { dataLoaded.current = false; return; }
    apiFetch<SettingsData>('/api/settings').then(d => { setData(d); dataLoaded.current = true; }).catch(() => setStatus('load-error'));
    setFont(localStorage.getItem('prose-font') ?? 'lora');
    setContentWidth(localStorage.getItem('content-width') ?? '780px');
    const stored = localStorage.getItem('theme');
    setDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    loadDisabledState();
    const initial: Record<string, boolean> = {};
    for (const r of getAllRenderers()) initial[r.id] = isRendererEnabled(r.id);
    setPluginStates(initial);
    setStatus('idle');
  }, [open]);

  // Switch to requested tab when opening with initialTab
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  // Apply font immediately
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

  // Apply content width immediately
  useEffect(() => {
    document.documentElement.style.setProperty('--content-width-override', contentWidth);
    localStorage.setItem('content-width', contentWidth);
  }, [contentWidth]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Auto-save with debounce when data changes
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
      providers: {
        anthropic: { apiKey: '', model: '' },
        openai:    { apiKey: '', model: '', baseUrl: '' },
      },
    };
    // Set defaults — auto-save will persist them
    setData(d => d ? { ...d, ai: defaults } : d);
    // 🟢 MINOR #4: Refetch after auto-save completes (800ms debounce + 500ms save operation)
    // Rather than magic 1200ms, wait for save to finish before refetching env-resolved values
    const DEBOUNCE_DELAY = 800;
    const SAVE_OPERATION_TIME = 500;
    setTimeout(() => {
      apiFetch<SettingsData>('/api/settings').then(d => { setData(d); }).catch(() => setStatus('error'));
    }, DEBOUNCE_DELAY + SAVE_OPERATION_TIME);
  }, [data]);

  if (!open) return null;

  const env = data?.envOverrides ?? {};

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai', label: t.settings.tabs.ai, icon: <Sparkles size={13} /> },
    { id: 'appearance', label: t.settings.tabs.appearance, icon: <Palette size={13} /> },
    { id: 'knowledge', label: t.settings.tabs.knowledge, icon: <Database size={13} /> },
    { id: 'sync', label: t.settings.tabs.sync ?? 'Sync', icon: <RefreshCw size={13} /> },
    { id: 'mcp', label: t.settings.tabs.mcp ?? 'MCP', icon: <Plug size={13} /> },
    { id: 'plugins', label: t.settings.tabs.plugins, icon: <Puzzle size={13} /> },
    { id: 'monitoring', label: t.settings.tabs.monitoring, icon: <Activity size={13} /> },
    { id: 'agents', label: t.settings.tabs.agents ?? 'Agents', icon: <Users size={13} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Settings" className="w-full md:max-w-xl md:mx-4 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col h-[88vh] md:h-auto md:max-h-[78vh]">
        {/* Mobile drag indicator */}
        <div className="flex justify-center pt-2 pb-0 md:hidden">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings size={15} className="text-muted-foreground" />
            <span className="font-display">{t.settings.title}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4 shrink-0 overflow-x-auto scrollbar-none">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                tab === t.id
                  ? 'border-amber-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-5 space-y-5">
          {status === 'load-error' && (tab === 'ai' || tab === 'knowledge') ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle size={20} className="text-destructive" />
              <p className="text-sm text-destructive font-medium">Failed to load settings</p>
              <p className="text-xs text-muted-foreground">Check that the server is running and AUTH_TOKEN is configured correctly.</p>
            </div>
          ) : !data && tab !== 'appearance' && tab !== 'mcp' && tab !== 'sync' && tab !== 'agents' ? (
            <div className="flex justify-center py-8">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {tab === 'ai' && data?.ai && <AiTab data={data} updateAi={updateAi} updateAgent={updateAgent} t={t} />}
              {tab === 'appearance' && <AppearanceTab font={font} setFont={setFont} contentWidth={contentWidth} setContentWidth={setContentWidth} dark={dark} setDark={setDark} locale={locale} setLocale={setLocale} t={t} />}
              {tab === 'knowledge' && data && <KnowledgeTab data={data} setData={setData} t={t} />}
              {tab === 'plugins' && <PluginsTab pluginStates={pluginStates} setPluginStates={setPluginStates} t={t} />}
              {tab === 'sync' && <SyncTab t={t} />}
              {tab === 'mcp' && <McpTab t={t} />}
              {tab === 'monitoring' && <MonitoringTab t={t} />}
              {tab === 'agents' && <AgentsTab t={t} />}
            </>
          )}
        </div>

        {/* Footer — status bar + contextual actions */}
        {(tab === 'ai' || tab === 'knowledge') && (
          <div className="px-5 py-2.5 border-t border-border shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {tab === 'ai' && Object.values(env).some(Boolean) && (
                <button
                  onClick={restoreFromEnv}
                  disabled={saving || !data}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw size={12} />
                  {t.settings.ai.restoreFromEnv}
                </button>
              )}
              {tab === 'knowledge' && (
                <a
                  href="/setup?force=1"
                  className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <RotateCcw size={12} />
                  {t.settings.reconfigure}
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
              {saving && (
                <><Loader2 size={12} className="animate-spin text-muted-foreground" /><span className="text-muted-foreground">{t.settings.save}...</span></>
              )}
              {status === 'saved' && (
                <><CheckCircle2 size={12} className="text-success" /><span className="text-success">{t.settings.saved}</span></>
              )}
              {status === 'error' && (
                <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">{t.settings.saveFailed}</span></>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
