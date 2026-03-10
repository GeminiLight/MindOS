'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Settings, Save, Loader2, AlertCircle, CheckCircle2, Puzzle, RotateCcw } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { Locale } from '@/lib/i18n';
import { getAllRenderers, loadDisabledState, setRendererEnabled, isRendererEnabled } from '@/lib/renderers/registry';
import '@/lib/renderers/index';

interface AiSettings {
  provider: 'anthropic' | 'openai';
  anthropicModel: string;
  anthropicApiKey: string;
  openaiModel: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
}

interface SettingsData {
  ai: AiSettings;
  mindRoot: string;
  envOverrides?: Record<string, boolean>;
  envValues?: Record<string, string>;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const CONTENT_WIDTHS = [
  { value: '680px', label: 'Narrow (680px)' },
  { value: '780px', label: 'Default (780px)' },
  { value: '960px', label: 'Wide (960px)' },
  { value: '100%', label: 'Full width' },
];

type Tab = 'ai' | 'appearance' | 'knowledge' | 'plugins' | 'shortcuts';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{children}</p>;
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-foreground font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${className}`}
    />
  );
}

function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${className}`}
    />
  );
}

function EnvBadge({ overridden }: { overridden: boolean }) {
  if (!overridden) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-mono ml-1.5">env</span>
  );
}

function ApiKeyInput({ value, onChange, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const isMasked = value === '***set***';

  return (
    <input
      type="password"
      value={isMasked ? '••••••••••••••••' : value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder ?? 'sk-...'}
      disabled={disabled}
      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      onFocus={() => { if (isMasked) onChange(''); }}
    />
  );
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('ai');
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const { t, locale, setLocale } = useLocale();

  // Appearance state (localStorage-based)
  const [font, setFont] = useState('lora');
  const [contentWidth, setContentWidth] = useState('780px');
  const [dark, setDark] = useState(true);
  // Plugin enabled state — local UI state synced to localStorage via registry helpers
  const [pluginStates, setPluginStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    fetch('/api/settings').then(r => r.json()).then(setData).catch(() => {});
    setFont(localStorage.getItem('prose-font') ?? 'lora');
    setContentWidth(localStorage.getItem('content-width') ?? '780px');
    const stored = localStorage.getItem('theme');
    setDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    // Load plugin enabled states
    loadDisabledState();
    const initial: Record<string, boolean> = {};
    for (const r of getAllRenderers()) initial[r.id] = isRendererEnabled(r.id);
    setPluginStates(initial);
    setStatus('idle');
  }, [open]);

  const toggleTheme = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }, [dark]);

  // Apply appearance immediately
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

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSave = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: data.ai, mindRoot: data.mindRoot }),
      });
      setStatus(res.ok ? 'saved' : 'error');
      setTimeout(() => setStatus('idle'), 2500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    } finally {
      setSaving(false);
    }
  }, [data]);

  const updateAi = useCallback((patch: Partial<AiSettings>) => {
    setData(d => d ? { ...d, ai: { ...d.ai, ...patch } } : d);
  }, []);

  // Restore all AI fields to defaults (empty) so .env values take effect, then auto-save
  const restoreFromEnv = useCallback(async () => {
    if (!data) return;
    const defaults: AiSettings = {
      provider: '' as 'anthropic',
      anthropicModel: '',
      anthropicApiKey: '',
      openaiModel: '',
      openaiApiKey: '',
      openaiBaseUrl: '',
    };
    setData(d => d ? { ...d, ai: defaults } : d);
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: defaults, mindRoot: data.mindRoot }),
      });
      setStatus(res.ok ? 'saved' : 'error');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
    // Re-fetch to get fresh envOverrides/envValues
    fetch('/api/settings').then(r => r.json()).then(setData).catch(() => {});
    setTimeout(() => setStatus('idle'), 2500);
  }, [data]);

  if (!open) return null;

  const env = data?.envOverrides ?? {};
  const envVal = data?.envValues ?? {};

  const FONTS = [
    { value: 'lora', label: 'Lora (serif)', style: { fontFamily: 'Lora, Georgia, serif' } },
    { value: 'ibm-plex-sans', label: 'IBM Plex Sans', style: { fontFamily: "'IBM Plex Sans', sans-serif" } },
    { value: 'geist', label: 'Geist', style: { fontFamily: 'var(--font-geist-sans), sans-serif' } },
    { value: 'ibm-plex-mono', label: 'IBM Plex Mono (mono)', style: { fontFamily: "'IBM Plex Mono', monospace" } },
  ];

  const TABS: { id: Tab; label: string }[] = [
    { id: 'ai', label: t.settings.tabs.ai },
    { id: 'appearance', label: t.settings.tabs.appearance },
    { id: 'knowledge', label: t.settings.tabs.knowledge },
    { id: 'plugins', label: t.settings.tabs.plugins },
    { id: 'shortcuts', label: t.settings.tabs.shortcuts },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Settings" className="w-full max-w-xl mx-4 bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[78vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings size={15} className="text-muted-foreground" />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{t.settings.title}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4 shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-amber-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-5 space-y-5">
          {!data && tab !== 'shortcuts' && tab !== 'appearance' ? (
            <div className="flex justify-center py-8">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : (

            <>
              {/* AI Tab */}
              {tab === 'ai' && data && (
                <div className="space-y-5">
                  <Field label={<>{t.settings.ai.provider} <EnvBadge overridden={env.AI_PROVIDER} /></>}>
                    <Select
                      value={data.ai.provider}
                      onChange={e => updateAi({ provider: e.target.value as 'anthropic' | 'openai' })}
                    >
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="openai">OpenAI / compatible</option>
                    </Select>
                  </Field>

                  {data.ai.provider === 'anthropic' ? (
                    <>
                      <Field label={<>{t.settings.ai.model} <EnvBadge overridden={env.ANTHROPIC_MODEL} /></>}>
                        <Input
                          value={data.ai.anthropicModel}
                          onChange={e => updateAi({ anthropicModel: e.target.value })}
                          placeholder={envVal.ANTHROPIC_MODEL || 'claude-sonnet-4-6'}
                        />
                      </Field>
                      <Field
                        label={<>{t.settings.ai.apiKey} <EnvBadge overridden={env.ANTHROPIC_API_KEY} /></>}
                        hint={env.ANTHROPIC_API_KEY ? t.settings.ai.envFieldNote('ANTHROPIC_API_KEY') : t.settings.ai.keyHint}
                      >
                        <ApiKeyInput
                          value={data.ai.anthropicApiKey}
                          onChange={v => updateAi({ anthropicApiKey: v })}
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label={<>{t.settings.ai.model} <EnvBadge overridden={env.OPENAI_MODEL} /></>}>
                        <Input
                          value={data.ai.openaiModel}
                          onChange={e => updateAi({ openaiModel: e.target.value })}
                          placeholder={envVal.OPENAI_MODEL || 'gpt-4o-mini'}
                        />
                      </Field>
                      <Field
                        label={<>{t.settings.ai.apiKey} <EnvBadge overridden={env.OPENAI_API_KEY} /></>}
                        hint={env.OPENAI_API_KEY ? t.settings.ai.envFieldNote('OPENAI_API_KEY') : t.settings.ai.keyHint}
                      >
                        <ApiKeyInput
                          value={data.ai.openaiApiKey}
                          onChange={v => updateAi({ openaiApiKey: v })}
                        />
                      </Field>
                      <Field
                        label={<>{t.settings.ai.baseUrl} <EnvBadge overridden={env.OPENAI_BASE_URL} /></>}
                        hint={t.settings.ai.baseUrlHint}
                      >
                        <Input
                          value={data.ai.openaiBaseUrl}
                          onChange={e => updateAi({ openaiBaseUrl: e.target.value })}
                          placeholder={envVal.OPENAI_BASE_URL || 'https://api.openai.com/v1'}
                        />
                      </Field>
                    </>
                  )}

                  {Object.values(env).some(Boolean) && (
                    <div className="flex items-start gap-2 text-xs text-amber-500/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span>{t.settings.ai.envHint}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Appearance Tab */}
              {tab === 'appearance' && (
                <div className="space-y-5">
                  <Field label={t.settings.appearance.readingFont}>
                    <Select value={font} onChange={e => setFont(e.target.value)}>
                      {FONTS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1.5 px-0.5" style={{ fontFamily: FONTS.find(f => f.value === font)?.style.fontFamily }}>
                      {t.settings.appearance.fontPreview}
                    </p>
                  </Field>

                  <Field label={t.settings.appearance.contentWidth}>
                    <div className="grid grid-cols-2 gap-2">
                      {CONTENT_WIDTHS.map(w => (
                        <button
                          key={w.value}
                          type="button"
                          onClick={() => setContentWidth(w.value)}
                          className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                            contentWidth === w.value
                              ? 'border-amber-500 bg-amber-500/10 text-foreground'
                              : 'border-border text-muted-foreground hover:border-border/80 hover:bg-muted'
                          }`}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label={t.settings.appearance.colorTheme}>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'dark', label: t.settings.appearance.dark },
                        { value: 'light', label: t.settings.appearance.light },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            const isDark = opt.value === 'dark';
                            setDark(isDark);
                            document.documentElement.classList.toggle('dark', isDark);
                            localStorage.setItem('theme', opt.value);
                          }}
                          className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                            (opt.value === 'dark') === dark
                              ? 'border-amber-500 bg-amber-500/10 text-foreground'
                              : 'border-border text-muted-foreground hover:border-border/80 hover:bg-muted'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label={t.settings.appearance.language}>
                    <div className="grid grid-cols-2 gap-2">
                      {([['en', 'English'], ['zh', '中文']] as [Locale, string][]).map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setLocale(code)}
                          className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                            locale === code
                              ? 'border-amber-500 bg-amber-500/10 text-foreground'
                              : 'border-border text-muted-foreground hover:border-border/80 hover:bg-muted'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <p className="text-xs text-muted-foreground">{t.settings.appearance.browserNote}</p>
                </div>
              )}

              {/* Knowledge Base Tab */}
              {tab === 'knowledge' && data && (
                <div className="space-y-5">
                  <Field
                    label={<>{t.settings.knowledge.sopRoot} <EnvBadge overridden={env.MIND_ROOT} /></>}
                    hint={env.MIND_ROOT ? t.settings.knowledge.envNote : t.settings.knowledge.sopRootHint}
                  >
                    <Input
                      value={data.mindRoot}
                      onChange={e => setData(d => d ? { ...d, mindRoot: e.target.value } : d)}
                      placeholder="/path/to/your/notes"
                    />
                  </Field>
                </div>
              )}

              {/* Plugins Tab */}
              {tab === 'plugins' && (
                <div className="space-y-5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.settings.plugins.title}</p>

                  {getAllRenderers().length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.settings.plugins.noPlugins}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {getAllRenderers().map(renderer => {
                        const enabled = pluginStates[renderer.id] ?? true;
                        return (
                          <div
                            key={renderer.id}
                            className={`border rounded-xl p-4 transition-colors ${enabled ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <span className="text-2xl leading-none mt-0.5">{renderer.icon}</span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-foreground">{renderer.name}</span>
                                    {renderer.builtin && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                        {t.settings.plugins.builtinBadge}
                                      </span>
                                    )}
                                    <div className="flex gap-1 flex-wrap">
                                      {renderer.tags.map(tag => (
                                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{renderer.description}</p>
                                  <p className="text-[11px] text-muted-foreground/60 mt-1.5 font-mono">
                                    {t.settings.plugins.matchHint}: <code className="bg-muted px-1 rounded">{renderer.match.toString().match(/\/(.+)\//)?.[1] ?? '—'}</code>
                                  </p>
                                </div>
                              </div>

                              {/* Toggle */}
                              <button
                                onClick={() => {
                                  const next = !enabled;
                                  setRendererEnabled(renderer.id, next);
                                  setPluginStates(s => ({ ...s, [renderer.id]: next }));
                                }}
                                role="switch"
                                aria-checked={enabled}
                                className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${enabled ? 'bg-amber-600' : 'bg-muted border border-border'}`}
                                title={enabled ? t.settings.plugins.enabled : t.settings.plugins.disabled}
                              >
                                <span
                                  className={`absolute top-[3px] w-3.5 h-3.5 rounded-full shadow-sm transition-all ${enabled ? 'left-[18px] bg-white' : 'left-[3px] bg-muted-foreground/50'}`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Coming soon */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed border-border rounded-xl px-4 py-3">
                    <Puzzle size={13} className="shrink-0" />
                    <span>{t.settings.plugins.comingSoon}</span>
                  </div>
                </div>
              )}

              {/* Shortcuts Tab */}
              {tab === 'shortcuts' && (
                <div className="space-y-1">
                  {t.shortcuts.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                      <span className="text-sm text-foreground">{s.description}</span>
                      <div className="flex items-center gap-1">
                        {s.keys.map((k, j) => (
                          <kbd key={j} className="px-2 py-0.5 text-xs font-mono bg-muted border border-border rounded text-foreground">{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {(tab === 'ai' || tab === 'knowledge') && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {tab === 'ai' && Object.values(env).some(Boolean) && (
                <button
                  onClick={restoreFromEnv}
                  disabled={saving || !data}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw size={13} />
                  {t.settings.ai.restoreFromEnv}
                </button>
              )}
              <div className="flex items-center gap-1.5 text-xs">
                {status === 'saved' && (
                  <><CheckCircle2 size={13} className="text-green-500" /><span className="text-green-500">{t.settings.saved}</span></>
                )}
                {status === 'error' && (
                  <><AlertCircle size={13} className="text-destructive" /><span className="text-destructive">{t.settings.saveFailed}</span></>
                )}
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !data}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ background: 'var(--amber)', color: '#131210' }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {t.settings.save}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
