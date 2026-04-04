'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AlertCircle, ChevronDown, Loader2, Sparkles, Bot, Monitor, ExternalLink } from 'lucide-react';
import type { AiSettings, AgentSettings, ProviderConfig, SettingsData, AiTabProps } from './types';
import { Field, Select, Input, EnvBadge, ApiKeyInput, Toggle, SettingCard, SettingRow } from './Primitives';
import { useLocale } from '@/lib/stores/locale-store';
import { type ProviderId, PROVIDER_PRESETS, isProviderId, getApiKeyEnvVar, getDefaultBaseUrl } from '@/lib/agent/providers';
import ProviderSelect from '@/components/shared/ProviderSelect';

type TestState = 'idle' | 'testing' | 'ok' | 'error';
type ErrorCode = 'auth_error' | 'model_not_found' | 'rate_limited' | 'network_error' | 'unknown';

interface TestResult {
  state: TestState;
  latency?: number;
  error?: string;
  code?: ErrorCode;
}

function errorMessage(t: AiTabProps['t'], code?: ErrorCode): string {
  switch (code) {
    case 'auth_error': return t.settings.ai.testKeyAuthError;
    case 'model_not_found': return t.settings.ai.testKeyModelNotFound;
    case 'rate_limited': return t.settings.ai.testKeyRateLimited;
    case 'network_error': return t.settings.ai.testKeyNetworkError;
    default: return t.settings.ai.testKeyUnknown;
  }
}

export function AiTab({ data, updateAi, updateAgent, t }: AiTabProps) {
  const { locale } = useLocale();
  const env = data.envOverrides ?? {};
  const envVal = data.envValues ?? {};
  const provider = data.ai.provider;
  const preset = isProviderId(provider) ? PROVIDER_PRESETS[provider] : null;

  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const okTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevProviderRef = useRef(provider);

  useEffect(() => {
    if (prevProviderRef.current !== provider) {
      prevProviderRef.current = provider;
      setTestResult({});
      if (okTimerRef.current) { clearTimeout(okTimerRef.current); okTimerRef.current = undefined; }
    }
  }, [provider]);

  useEffect(() => () => { if (okTimerRef.current) clearTimeout(okTimerRef.current); }, []);

  useEffect(() => {
    const v = data.agent?.reconnectRetries ?? 3;
    try { localStorage.setItem('mindos-reconnect-retries', String(v)); } catch (err) { console.warn("[AiTab] localStorage setItem reconnectRetries failed:", err); }
  }, [data.agent?.reconnectRetries]);

  const handleTestKey = useCallback(async (providerName: ProviderId) => {
    const prov = data.ai.providers?.[providerName] ?? {} as ProviderConfig;
    setTestResult(prev => ({ ...prev, [providerName]: { state: 'testing' } }));

    try {
      const body: Record<string, string> = { provider: providerName };
      if (prov.apiKey) body.apiKey = prov.apiKey;
      if (prov.model) body.model = prov.model;
      if (prov.baseUrl) body.baseUrl = prov.baseUrl;

      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        setTestResult(prev => ({ ...prev, [providerName]: { state: 'ok', latency: json.latency } }));
        if (okTimerRef.current) clearTimeout(okTimerRef.current);
        okTimerRef.current = setTimeout(() => {
          setTestResult(prev => ({ ...prev, [providerName]: { state: 'idle' } }));
        }, 8000);
      } else {
        setTestResult(prev => ({
          ...prev,
          [providerName]: { state: 'error', error: json.error, code: json.code },
        }));
      }
    } catch {
      setTestResult(prev => ({
        ...prev,
        [providerName]: { state: 'error', code: 'network_error', error: 'Network error' },
      }));
    }
  }, [data.ai.providers]);

  const patchProvider = useCallback((name: ProviderId, patch: Partial<ProviderConfig>) => {
    if ('apiKey' in patch) {
      setTestResult(prev => ({ ...prev, [name]: { state: 'idle' } }));
    }
    updateAi({
      providers: {
        ...data.ai.providers,
        [name]: { ...data.ai.providers?.[name], ...patch },
      },
    });
  }, [data.ai.providers, updateAi]);

  const currentConfig = data.ai.providers?.[provider] ?? { apiKey: '', model: '', baseUrl: '' };
  const envKeyName = preset ? getApiKeyEnvVar(provider) : undefined;
  const activeApiKey = currentConfig.apiKey;
  const activeEnvKey = envKeyName ? env[envKeyName] : false;
  const hasFallbackKey = !!preset?.apiKeyFallback;
  const missingApiKey = !activeApiKey && !activeEnvKey && !hasFallbackKey;

  const configuredProviders = new Set(
    Object.entries(data.ai.providers ?? {})
      .filter(([id, cfg]) => (cfg && cfg.apiKey) || PROVIDER_PRESETS[id as ProviderId]?.apiKeyFallback)
      .map(([id]) => id as ProviderId),
  );

  const renderTestButton = (providerName: ProviderId, hasKey: boolean, hasEnv: boolean) => {
    const result = testResult[providerName] ?? { state: 'idle' as TestState };
    const hasFallback = !!PROVIDER_PRESETS[providerName]?.apiKeyFallback;
    const disabled = result.state === 'testing' || (!hasKey && !hasEnv && !hasFallback);

    return (
      <div className="flex items-center gap-2 mt-1.5">
        <button
          type="button"
          disabled={disabled}
          title={disabled ? t.hints.testInProgressOrNoKey : undefined}
          onClick={() => handleTestKey(providerName)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {result.state === 'testing' ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {t.settings.ai.testKeyTesting}
            </>
          ) : (
            t.settings.ai.testKey
          )}
        </button>
        {result.state === 'ok' && result.latency != null && (
          <span className="text-xs text-success">
            {t.settings.ai.testKeyOk(result.latency)}
          </span>
        )}
        {result.state === 'error' && (
          <span className="text-xs text-error">✗ {errorMessage(t, result.code)}</span>
        )}
      </div>
    );
  };

  const displayName = preset ? (locale === 'zh' ? preset.nameZh : preset.name) : provider;

  return (
    <div className="space-y-4">
      {/* ── Card 1: AI Provider ── */}
      <SettingCard
        icon={<Sparkles size={15} />}
        title={t.settings.ai.provider}
        description={displayName}
      >
        <ProviderSelect
          value={provider}
          onChange={id => { if (id !== 'skip') updateAi({ provider: id }); }}
          compact
          configuredProviders={configuredProviders}
        />

        {/* Provider configuration fields */}
        {preset && (
          <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {/* 1. API Key — most essential, enter first */}
            <Field
              label={<>{t.settings.ai.apiKey} {envKeyName && <EnvBadge overridden={env[envKeyName]} />}</>}
              hint={activeEnvKey ? t.settings.ai.envFieldNote(envKeyName!) : hasFallbackKey ? t.settings.ai.keyOptionalHint : t.settings.ai.keyHint}
            >
              <ApiKeyInput
                value={currentConfig.apiKey}
                onChange={v => patchProvider(provider, { apiKey: v })}
              />
              {preset.signupUrl && !currentConfig.apiKey && !activeEnvKey && (
                <a
                  href={preset.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs mt-1.5 hover:underline"
                  style={{ color: 'var(--amber)' }}
                >
                  <ExternalLink size={10} />
                  {hasFallbackKey
                    ? (locale === 'zh' ? `下载 ${preset.nameZh}` : `Download ${preset.name}`)
                    : (locale === 'zh' ? `获取 ${preset.nameZh} API Key` : `Get ${preset.name} API Key`)}
                </a>
              )}
            </Field>

            {/* 2. Base URL — before Model so "List Models" uses the correct endpoint */}
            {preset.supportsBaseUrl && (
              <Field
                label={t.settings.ai.baseUrl}
                hint={t.settings.ai.baseUrlHint}
              >
                <Input
                  value={currentConfig.baseUrl ?? ''}
                  onChange={e => patchProvider(provider, { baseUrl: e.target.value })}
                  placeholder={preset.fixedBaseUrl || getDefaultBaseUrl(provider) || 'https://api.openai.com/v1'}
                />
              </Field>
            )}

            {/* 3. Model — after Base URL so "List Models" queries the right endpoint */}
            <Field label={t.settings.ai.model}>
              <ModelInput
                value={currentConfig.model}
                onChange={v => patchProvider(provider, { model: v })}
                placeholder={preset.defaultModel}
                provider={provider}
                apiKey={currentConfig.apiKey}
                envKey={!!activeEnvKey}
                baseUrl={currentConfig.baseUrl}
                supportsListModels={preset.supportsListModels}
                t={t}
              />
            </Field>

            {/* 4. Test — after all fields, tests the complete configuration */}
            {renderTestButton(provider, !!currentConfig.apiKey, !!activeEnvKey)}
          </div>
        )}

        {/* Inline warnings */}
        {missingApiKey && (
          <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{t.settings.ai.noApiKey}</span>
          </div>
        )}
        {Object.values(env).some(Boolean) && (
          <div className="flex items-start gap-2 text-xs text-[var(--amber)] bg-[var(--amber-subtle)] border border-[var(--amber)]/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{t.settings.ai.envHint}</span>
          </div>
        )}
      </SettingCard>

      {/* ── Card 2: Agent Behavior ── */}
      <SettingCard
        icon={<Bot size={15} />}
        title={t.settings.agent.title}
        description={t.settings.agent.subtitle ?? 'Configure how the AI agent operates'}
      >
        <SettingRow label={t.settings.agent.maxSteps} hint={t.settings.agent.maxStepsHint}>
          <Select
            value={String(data.agent?.maxSteps ?? 20)}
            onChange={e => updateAgent({ maxSteps: Number(e.target.value) })}
            className="w-20"
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="25">25</option>
            <option value="30">30</option>
          </Select>
        </SettingRow>

        <SettingRow label={t.settings.agent.contextStrategy} hint={t.settings.agent.contextStrategyHint}>
          <Select
            value={data.agent?.contextStrategy ?? 'auto'}
            onChange={e => updateAgent({ contextStrategy: e.target.value as 'auto' | 'off' })}
            className="w-24"
          >
            <option value="auto">{t.settings.agent.contextStrategyAuto}</option>
            <option value="off">{t.settings.agent.contextStrategyOff}</option>
          </Select>
        </SettingRow>

        <SettingRow label={t.settings.agent.reconnectRetries} hint={t.settings.agent.reconnectRetriesHint}>
          <Select
            value={String(data.agent?.reconnectRetries ?? 3)}
            onChange={e => {
              const v = Number(e.target.value);
              updateAgent({ reconnectRetries: v });
              try { localStorage.setItem('mindos-reconnect-retries', String(v)); } catch (err) { console.warn("[AiTab] localStorage setItem reconnectRetries failed:", err); }
            }}
            className="w-20"
          >
            <option value="0">Off</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </Select>
        </SettingRow>

        {/* Thinking — show for providers that support it */}
        {preset?.supportsThinking && (
          <>
            <SettingRow label={t.settings.agent.thinking} hint={t.settings.agent.thinkingHint}>
              <Toggle checked={data.agent?.enableThinking ?? false} onChange={() => updateAgent({ enableThinking: !(data.agent?.enableThinking ?? false) })} />
            </SettingRow>

            {data.agent?.enableThinking && (
              <Field label={t.settings.agent.thinkingBudget} hint={t.settings.agent.thinkingBudgetHint}>
                <Input
                  type="number"
                  value={String(data.agent?.thinkingBudget ?? 5000)}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) updateAgent({ thinkingBudget: Math.max(1000, Math.min(50000, v)) });
                  }}
                  min={1000}
                  max={50000}
                  step={1000}
                />
              </Field>
            )}
          </>
        )}
      </SettingCard>

      {/* ── Card 3: Display Mode ── */}
      <AskDisplayMode />
    </div>
  );
}

/* ── Model Input with "List models" picker ── */

function ModelInput({
  value, onChange, placeholder, provider, apiKey, envKey, baseUrl, supportsListModels, t,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  provider: ProviderId;
  apiKey: string;
  envKey?: boolean;
  baseUrl?: string;
  supportsListModels: boolean;
  t: AiTabProps['t'];
}) {
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);
  const fetchVersionRef = useRef(0);
  const loadingRef = useRef(false);

  const hasKey = !!apiKey || !!envKey || !!PROVIDER_PRESETS[provider]?.apiKeyFallback;

  // Reset fetched cache when provider/key/baseUrl changes
  useEffect(() => {
    fetchedRef.current = false;
    fetchVersionRef.current++;
    setModels(null);
  }, [provider, apiKey, baseUrl]);

  const fetchModels = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    if (!silent) setError('');
    const version = fetchVersionRef.current;
    try {
      const body: Record<string, string> = { provider };
      if (apiKey) body.apiKey = apiKey;
      if (baseUrl) body.baseUrl = baseUrl;

      const res = await fetch('/api/settings/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (version !== fetchVersionRef.current) return;
      const json = await res.json();
      if (version !== fetchVersionRef.current) return;
      if (json.ok && Array.isArray(json.models)) {
        setModels(json.models);
        fetchedRef.current = true;
        if (!silent) setOpen(true);
      } else if (!silent) {
        setError(json.error || 'Failed to fetch models');
      }
    } catch {
      if (version !== fetchVersionRef.current) return;
      if (!silent) setError('Network error');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [provider, apiKey, baseUrl]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (!fetchedRef.current && supportsListModels && hasKey && !loadingRef.current) {
      fetchModels(true);
    }
  }, [supportsListModels, hasKey, fetchModels]);

  // Filtered models for typeahead
  const filtered = useMemo(() => {
    if (!models || !value.trim()) return models ?? [];
    const q = value.toLowerCase();
    return models.filter(m => m.toLowerCase().includes(q));
  }, [models, value]);

  // Show typeahead when focused + models loaded + user is typing (or Browse was clicked)
  const showDropdown = open || (focused && models !== null && value.trim().length > 0 && filtered.length > 0);

  // Reset highlight when filtered list changes
  useEffect(() => { setHighlightIdx(-1); }, [filtered]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-model-item]');
    items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = showDropdown ? filtered : [];
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && highlightIdx >= 0 && highlightIdx < items.length) {
      e.preventDefault();
      onChange(items[highlightIdx]);
      setOpen(false);
      setFocused(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setFocused(false);
    }
  }, [showDropdown, filtered, highlightIdx, onChange]);

  useEffect(() => {
    if (!showDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const displayList = filtered;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={e => { onChange(e.target.value); if (!open) setFocused(true); }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1"
          autoComplete="off"
        />
        {supportsListModels && (
          <button
            type="button"
            disabled={!hasKey || loading}
            onClick={() => fetchModels(false)}
            title={t.settings.ai.listModels}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
            {t.settings.ai.listModels}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-error mt-1">{error}</p>}
      {showDropdown && displayList.length > 0 && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {displayList.map((m, i) => (
            <button
              key={m}
              type="button"
              data-model-item
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                m === value ? 'bg-accent/60 font-medium'
                : i === highlightIdx ? 'bg-accent'
                : 'hover:bg-accent'
              }`}
              onClick={() => { onChange(m); setOpen(false); setFocused(false); }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {open && displayList.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs text-muted-foreground">
          {t.settings.ai.noModelsFound}
        </div>
      )}
    </div>
  );
}

/* ── Ask AI Display Mode (localStorage-based, no server roundtrip) ── */

function AskDisplayMode() {
  const { t } = useLocale();
  const [mode, setMode] = useState<'panel' | 'popup'>('panel');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ask-mode');
      if (stored === 'popup') setMode('popup');
    } catch (err) { console.warn("[AiTab] localStorage getItem ask-mode failed:", err); }
  }, []);

  const handleChange = (value: string) => {
    const next = value as 'panel' | 'popup';
    setMode(next);
    try { localStorage.setItem('ask-mode', next); } catch (err) { console.warn("[AiTab] localStorage setItem ask-mode failed:", err); }
    window.dispatchEvent(new StorageEvent('storage', { key: 'ask-mode', newValue: next }));
  };

  return (
    <SettingCard
      icon={<Monitor size={15} />}
      title={t.settings.askDisplayMode?.label ?? 'Display Mode'}
      description={t.settings.askDisplayMode?.hint ?? 'Side panel stays docked on the right. Popup opens a floating dialog.'}
    >
      <Select value={mode} onChange={e => handleChange(e.target.value)}>
        <option value="panel">{t.settings.askDisplayMode?.panel ?? 'Side Panel'}</option>
        <option value="popup">{t.settings.askDisplayMode?.popup ?? 'Popup'}</option>
      </Select>
    </SettingCard>
  );
}
