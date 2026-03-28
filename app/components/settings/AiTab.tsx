'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AiSettings, AgentSettings, ProviderConfig, SettingsData, AiTabProps } from './types';
import { Field, Select, Input, EnvBadge, ApiKeyInput, Toggle, SectionLabel } from './Primitives';
import { useLocale } from '@/lib/LocaleContext';

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
  const env = data.envOverrides ?? {};
  const envVal = data.envValues ?? {};
  const provider = data.ai.provider;

  // --- Test key state ---
  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const okTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevProviderRef = useRef(provider);

  // Reset test result when provider changes
  useEffect(() => {
    if (prevProviderRef.current !== provider) {
      prevProviderRef.current = provider;
      setTestResult({});
      if (okTimerRef.current) { clearTimeout(okTimerRef.current); okTimerRef.current = undefined; }
    }
  }, [provider]);

  // Cleanup ok timer
  useEffect(() => () => { if (okTimerRef.current) clearTimeout(okTimerRef.current); }, []);

  // Sync reconnectRetries to localStorage so AskContent can read it without fetching settings
  useEffect(() => {
    const v = data.agent?.reconnectRetries ?? 3;
    try { localStorage.setItem('mindos-reconnect-retries', String(v)); } catch {}
  }, [data.agent?.reconnectRetries]);

  const handleTestKey = useCallback(async (providerName: 'anthropic' | 'openai') => {
    const prov = data.ai.providers?.[providerName] ?? {} as ProviderConfig;
    setTestResult(prev => ({ ...prev, [providerName]: { state: 'testing' } }));

    try {
      const body: Record<string, string> = { provider: providerName };
      if (prov.apiKey) body.apiKey = prov.apiKey;
      if (prov.model) body.model = prov.model;
      if (providerName === 'openai' && prov.baseUrl) body.baseUrl = prov.baseUrl;

      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        setTestResult(prev => ({ ...prev, [providerName]: { state: 'ok', latency: json.latency } }));
        // Auto-clear after 5s
        if (okTimerRef.current) clearTimeout(okTimerRef.current);
        okTimerRef.current = setTimeout(() => {
          setTestResult(prev => ({ ...prev, [providerName]: { state: 'idle' } }));
        }, 5000);
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

  // Reset test result when key changes
  const patchProviderWithReset = useCallback((name: 'anthropic' | 'openai', patch: Partial<ProviderConfig>) => {
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

  function patchProvider(name: 'anthropic' | 'openai', patch: Partial<ProviderConfig>) {
    patchProviderWithReset(name, patch);
  }

  const anthropic = data.ai.providers?.anthropic ?? { apiKey: '', model: '' };
  const openai    = data.ai.providers?.openai    ?? { apiKey: '', model: '', baseUrl: '' };

  const activeApiKey = provider === 'anthropic' ? anthropic.apiKey : openai.apiKey;
  const activeEnvKey = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  const missingApiKey = !activeApiKey && !activeEnvKey;

  // Test button helper
  const renderTestButton = (providerName: 'anthropic' | 'openai', hasKey: boolean, hasEnv: boolean) => {
    const result = testResult[providerName] ?? { state: 'idle' as TestState };
    const disabled = result.state === 'testing' || (!hasKey && !hasEnv);

    return (
      <div className="flex items-center gap-2 mt-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleTestKey(providerName)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          <span className="text-xs text-success">{t.settings.ai.testKeyOk(result.latency)}</span>
        )}
        {result.state === 'error' && (
          <span className="text-xs text-error">✗ {errorMessage(t, result.code)}</span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Field label={<>{t.settings.ai.provider} <EnvBadge overridden={env.AI_PROVIDER} /></>}>
        <Select
          value={provider}
          onChange={e => updateAi({ provider: e.target.value as 'anthropic' | 'openai' })}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI / compatible</option>
        </Select>
      </Field>

      {provider === 'anthropic' ? (
        <>
          <Field label={<>{t.settings.ai.model} <EnvBadge overridden={env.ANTHROPIC_MODEL} /></>}>
            <Input
              value={anthropic.model}
              onChange={e => patchProvider('anthropic', { model: e.target.value })}
              placeholder={envVal.ANTHROPIC_MODEL || 'claude-sonnet-4-6'}
            />
          </Field>
          <Field
            label={<>{t.settings.ai.apiKey} <EnvBadge overridden={env.ANTHROPIC_API_KEY} /></>}
            hint={env.ANTHROPIC_API_KEY ? t.settings.ai.envFieldNote('ANTHROPIC_API_KEY') : t.settings.ai.keyHint}
          >
            <ApiKeyInput
              value={anthropic.apiKey}
              onChange={v => patchProvider('anthropic', { apiKey: v })}
            />
            {renderTestButton('anthropic', !!anthropic.apiKey, !!env.ANTHROPIC_API_KEY)}
          </Field>
        </>
      ) : (
        <>
          <Field label={<>{t.settings.ai.model} <EnvBadge overridden={env.OPENAI_MODEL} /></>}>
            <Input
              value={openai.model}
              onChange={e => patchProvider('openai', { model: e.target.value })}
              placeholder={envVal.OPENAI_MODEL || 'gpt-5.4'}
            />
          </Field>
          <Field
            label={<>{t.settings.ai.apiKey} <EnvBadge overridden={env.OPENAI_API_KEY} /></>}
            hint={env.OPENAI_API_KEY ? t.settings.ai.envFieldNote('OPENAI_API_KEY') : t.settings.ai.keyHint}
          >
            <ApiKeyInput
              value={openai.apiKey}
              onChange={v => patchProvider('openai', { apiKey: v })}
            />
            {renderTestButton('openai', !!openai.apiKey, !!env.OPENAI_API_KEY)}
          </Field>
          <Field
            label={<>{t.settings.ai.baseUrl} <EnvBadge overridden={env.OPENAI_BASE_URL} /></>}
            hint={t.settings.ai.baseUrlHint}
          >
            <Input
              value={openai.baseUrl ?? ''}
              onChange={e => patchProvider('openai', { baseUrl: e.target.value })}
              placeholder={envVal.OPENAI_BASE_URL || 'https://api.openai.com/v1'}
            />
          </Field>
        </>
      )}

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

      {/* Agent Behavior */}
      <div className="pt-3 border-t border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t.settings.agent.title}</h3>

        <div className="space-y-4">
          <Field label={t.settings.agent.maxSteps} hint={t.settings.agent.maxStepsHint}>
            <Select
              value={String(data.agent?.maxSteps ?? 20)}
              onChange={e => updateAgent({ maxSteps: Number(e.target.value) })}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="20">20</option>
              <option value="25">25</option>
              <option value="30">30</option>
            </Select>
          </Field>

          <Field label={t.settings.agent.contextStrategy} hint={t.settings.agent.contextStrategyHint}>
            <Select
              value={data.agent?.contextStrategy ?? 'auto'}
              onChange={e => updateAgent({ contextStrategy: e.target.value as 'auto' | 'off' })}
            >
              <option value="auto">{t.settings.agent.contextStrategyAuto}</option>
              <option value="off">{t.settings.agent.contextStrategyOff}</option>
            </Select>
          </Field>

          <Field label={t.settings.agent.reconnectRetries} hint={t.settings.agent.reconnectRetriesHint}>
            <Select
              value={String(data.agent?.reconnectRetries ?? 3)}
              onChange={e => {
                const v = Number(e.target.value);
                updateAgent({ reconnectRetries: v });
                try { localStorage.setItem('mindos-reconnect-retries', String(v)); } catch {}
              }}
            >
              <option value="0">Off</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
            </Select>
          </Field>

          {provider === 'anthropic' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-foreground">{t.settings.agent.thinking}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t.settings.agent.thinkingHint}</div>
                </div>
                <Toggle checked={data.agent?.enableThinking ?? false} onChange={() => updateAgent({ enableThinking: !(data.agent?.enableThinking ?? false) })} />
              </div>

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
        </div>
      </div>

      {/* Ask AI Display Mode */}
      <AskDisplayMode />
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
    } catch {}
  }, []);

  const handleChange = (value: string) => {
    const next = value as 'panel' | 'popup';
    setMode(next);
    try { localStorage.setItem('ask-mode', next); } catch {}
    // Notify SidebarLayout to pick up the change
    window.dispatchEvent(new StorageEvent('storage', { key: 'ask-mode', newValue: next }));
  };

  return (
    <div className="pt-3 border-t border-border">
      <SectionLabel>MindOS Agent</SectionLabel>
      <div className="space-y-4">
        <Field label={t.settings.askDisplayMode?.label ?? 'Display Mode'} hint={t.settings.askDisplayMode?.hint ?? 'Side panel stays docked on the right. Popup opens a floating dialog.'}>
          <Select value={mode} onChange={e => handleChange(e.target.value)}>
            <option value="panel">{t.settings.askDisplayMode?.panel ?? 'Side Panel'}</option>
            <option value="popup">{t.settings.askDisplayMode?.popup ?? 'Popup'}</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}
