'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AlertCircle, Sparkles, Bot, Monitor, ExternalLink, RotateCcw, X } from 'lucide-react';
import type { ProviderConfig, AiTabProps } from './types';
import { Field, Select, Input, PasswordInput, EnvBadge, Toggle, SettingCard, SettingRow } from './Primitives';
import { useLocale } from '@/lib/stores/locale-store';
import { type ProviderId, PROVIDER_PRESETS, isProviderId, getApiKeyEnvVar, getDefaultBaseUrl } from '@/lib/agent/providers';
import ProviderSelect from '@/components/shared/ProviderSelect';
import ModelInput from '@/components/shared/ModelInput';
import { type CustomProvider } from '@/lib/custom-endpoints';
import { useCustomProviderForm, type TestResult } from './useCustomProviderForm';
import CustomProviderFields from './CustomProviderFields';
import { TestButton } from './TestButton';

export function AiTab({ data, updateAi, updateAgent, updateCustomProviders, t }: AiTabProps) {
  const { locale } = useLocale();
  const env = data.envOverrides ?? {};
  const envVal = data.envValues ?? {};
  const provider = data.ai.provider;
  const preset = isProviderId(provider) ? PROVIDER_PRESETS[provider] : null;

  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [customEditingId, setCustomEditingId] = useState<string | null>(null);
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

  const resetProvider = useCallback((name: ProviderId) => {
    setTestResult(prev => ({ ...prev, [name]: { state: 'idle' } }));
    updateAi({
      providers: {
        ...data.ai.providers,
        [name]: { apiKey: '', model: '', baseUrl: '' },
      },
    });
  }, [data.ai.providers, updateAi]);

  const customProviders = data.customProviders ?? [];
  const editingCustomProvider = useMemo(
    () => customEditingId ? customProviders.find(p => p.id === customEditingId) : null,
    [customEditingId, customProviders],
  );
  const handleSaveCustom = useCallback((cp: CustomProvider) => {
    const updated = customEditingId
      ? customProviders.map(p => p.id === customEditingId ? cp : p)
      : [...customProviders, cp];
    updateCustomProviders(updated);
    setCustomFormOpen(false);
    setCustomEditingId(null);
  }, [customEditingId, customProviders, updateCustomProviders]);
  const handleDeleteCustom = useCallback((id: string) => {
    if (customEditingId === id) { setCustomFormOpen(false); setCustomEditingId(null); }
    updateCustomProviders(customProviders.filter(p => p.id !== id));
  }, [customProviders, updateCustomProviders, customEditingId]);

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
          onChange={id => {
            if (id !== 'skip') updateAi({ provider: id });
            setCustomFormOpen(false);
            setCustomEditingId(null);
          }}
          compact
          configuredProviders={configuredProviders}
          customProviders={customProviders}
          onAddCustom={() => { setCustomEditingId(null); setCustomFormOpen(true); }}
          onEditCustom={id => { setCustomEditingId(id); setCustomFormOpen(true); }}
          onDeleteCustom={handleDeleteCustom}
        />

        {/* Inline custom provider form */}
        {customFormOpen && (
          <CustomProviderForm
            key={customEditingId ?? 'new'}
            initial={editingCustomProvider ?? undefined}
            onSave={handleSaveCustom}
            onCancel={() => { setCustomFormOpen(false); setCustomEditingId(null); }}
            t={t}
          />
        )}

        {/* Provider configuration fields */}
        {preset && !customFormOpen && (
          <div className="space-y-3 pt-3 border-t border-border">
            {/* 1. API Key — most essential, enter first */}
            <Field
              label={<>{t.settings.ai.apiKey} {envKeyName && <EnvBadge overridden={env[envKeyName]} />}</>}
              hint={activeEnvKey ? t.settings.ai.envFieldNote(envKeyName!) : hasFallbackKey ? t.settings.ai.keyOptionalHint : t.settings.ai.keyHint}
            >
              <PasswordInput
                value={currentConfig.apiKey}
                onChange={v => patchProvider(provider, { apiKey: v })}
                placeholder="sk-..."
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
                browseLabel={t.settings.ai.listModels}
                noModelsLabel={t.settings.ai.noModelsFound}
              />
            </Field>

            {/* 4. Test & Reset — after all fields */}
            <ProviderActions
              provider={provider}
              result={testResult[provider] ?? { state: 'idle' }}
              hasKey={!!currentConfig.apiKey}
              hasEnv={!!activeEnvKey}
              hasConfig={!!(currentConfig.apiKey || currentConfig.model || currentConfig.baseUrl)}
              onTest={() => handleTestKey(provider)}
              onReset={() => resetProvider(provider)}
              t={t}
            />
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

/* ── Provider Actions: Test + Reset ── */

function ProviderActions({
  provider, result, hasKey, hasEnv, hasConfig, onTest, onReset, t,
}: {
  provider: ProviderId;
  result: TestResult;
  hasKey: boolean;
  hasEnv: boolean;
  hasConfig: boolean;
  onTest: () => void;
  onReset: () => void;
  t: AiTabProps['t'];
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasFallback = !!PROVIDER_PRESETS[provider]?.apiKeyFallback;
  const canTest = hasKey || hasEnv || hasFallback;

  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);

  const handleResetClick = () => {
    if (confirmReset) {
      onReset();
      setConfirmReset(false);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    } else {
      setConfirmReset(true);
      confirmTimerRef.current = setTimeout(() => setConfirmReset(false), 3000);
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <TestButton result={result} disabled={!canTest} onTest={onTest} t={t} />

        {/* Right: Reset — subtle, icon-first, inline confirm */}
        {hasConfig && (
          <button
            type="button"
            onClick={handleResetClick}
            onBlur={() => { setConfirmReset(false); if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${
              confirmReset
                ? 'bg-destructive/10 text-destructive border border-destructive/25 font-medium'
                : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <RotateCcw size={12} />
            {confirmReset ? t.settings.ai.resetProviderConfirm : t.settings.ai.resetProvider}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Inline Custom Provider Form (uses shared hook + fields) ── */

function CustomProviderForm({
  initial, onSave, onCancel, t,
}: {
  initial?: CustomProvider;
  onSave: (provider: CustomProvider) => void;
  onCancel: () => void;
  t: AiTabProps['t'];
}) {
  const { locale } = useLocale();
  const form = useCustomProviderForm({ initial, onSave, locale });

  const formTitle = initial
    ? (locale === 'zh' ? '编辑自定义 Provider' : 'Edit Custom Provider')
    : (locale === 'zh' ? '添加自定义 Provider' : 'Add Custom Provider');

  const missingFields: string[] = [];
  if (!form.name.trim()) missingFields.push(locale === 'zh' ? '名称' : 'Name');
  if (!form.baseUrl.trim()) missingFields.push(locale === 'zh' ? '接口地址' : 'Base URL');
  if (!form.model.trim()) missingFields.push(locale === 'zh' ? '模型' : 'Model');

  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-sm font-medium text-foreground">{formTitle}</span>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label={locale === 'zh' ? '关闭' : 'Close'}
        >
          <X size={14} />
        </button>
      </div>

      {/* Form body */}
      <div className="p-4">
        <CustomProviderFields form={form} t={t} locale={locale} layout="compact" />

        {/* Actions */}
        <div className="flex items-center gap-2 pt-4">
          <TestButton result={form.testResult} disabled={!form.canSave} onTest={form.handleTest} t={t} />

          <div className="flex-1">
            {!form.canSave && missingFields.length > 0 && (
              <span className="text-2xs text-muted-foreground/60 pl-2">
                {locale === 'zh' ? `需要: ${missingFields.join('、')}` : `Required: ${missingFields.join(', ')}`}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            {t.settings?.customProviders?.modal?.buttonCancel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={form.handleSave}
            disabled={!form.canSave}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {locale === 'zh' ? '保存' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ModelInput is now a shared component at @/components/shared/ModelInput */

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
