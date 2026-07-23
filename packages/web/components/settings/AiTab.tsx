'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Sparkles, ExternalLink } from 'lucide-react';
import type { AiTabProps } from './types';
import { Field, Select, Input, PasswordInput, EnvBadge, SettingCard } from './Primitives';
import { useLocale } from '@/lib/stores/locale-store';
import { type ProviderId, PROVIDER_PRESETS, ALL_PROVIDER_IDS, getApiKeyEnvVar, getDefaultBaseUrl } from '@/lib/agent/providers';
import ProviderSelect from '@/components/shared/ProviderSelect';
import ModelInput from '@/components/shared/ModelInput';
import { type Provider } from '@/lib/custom-endpoints';
import type { TestResult } from './useCustomProviderForm';
import {
  rebaseProviderProtocol,
  resolveAiProviderSelection,
} from '@/lib/ai-provider-settings';
import { AskDisplayModeCard } from './ai/AskDisplayModeCard';
import { WebSearchCard } from './ai/WebSearchCard';
import { CustomProviderForm } from './ai/CustomProviderForm';
import { ProviderActions } from './ai/ProviderActions';
import { EmbeddingSearchCard } from './ai/EmbeddingSearchCard';
import { AgentBehaviorCard } from './ai/AgentBehaviorCard';

export function AiTab({ data, setData, updateAi, updateAgent, t }: AiTabProps) {
  const { locale } = useLocale();
  const env = data.envOverrides ?? {};

  // ── Current provider from the unified array ──
  const current = data.ai.providers.find(p => p.id === data.ai.activeProvider);
  const preset = current ? PROVIDER_PRESETS[current.protocol] : null;

  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(current?.name ?? '');
  const [pendingProtocol, setPendingProtocol] = useState<ProviderId | null>(null);
  const okTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevProviderRef = useRef(data.ai.activeProvider);

  useEffect(() => {
    if (prevProviderRef.current !== data.ai.activeProvider) {
      prevProviderRef.current = data.ai.activeProvider;
      setTestResult({});
      setPendingProtocol(null);
      if (okTimerRef.current) { clearTimeout(okTimerRef.current); okTimerRef.current = undefined; }
    }
  }, [data.ai.activeProvider]);

  useEffect(() => () => { if (okTimerRef.current) clearTimeout(okTimerRef.current); }, []);

  useEffect(() => {
    setNameDraft(current?.name ?? '');
  }, [current?.id, current?.name]);

  // ── Test key for the current provider ──
  const handleTestKey = useCallback(async () => {
    if (!current) return;
    const pid = current.id;
    setTestResult(prev => ({ ...prev, [pid]: { state: 'testing' } }));

    try {
      const body: Record<string, string> = { provider: current.protocol };
      if (current.apiKey) body.apiKey = current.apiKey;
      if (current.model) body.model = current.model;
      if (current.baseUrl) body.baseUrl = current.baseUrl;

      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        setTestResult(prev => ({ ...prev, [pid]: { state: 'ok', latency: json.latency } }));
        if (okTimerRef.current) clearTimeout(okTimerRef.current);
        okTimerRef.current = setTimeout(() => {
          setTestResult(prev => ({ ...prev, [pid]: { state: 'idle' } }));
        }, 8000);
      } else {
        setTestResult(prev => ({
          ...prev,
          [pid]: { state: 'error', error: json.error, code: json.code },
        }));
      }
    } catch {
      setTestResult(prev => ({
        ...prev,
        [pid]: { state: 'error', code: 'network_error', error: 'Network error' },
      }));
    }
  }, [current]);

  // ── Patch any field on the current provider (auto-save) ──
  const patchProvider = useCallback((patch: Partial<Provider>) => {
    if (!current) return;
    if ('apiKey' in patch) {
      setTestResult(prev => ({ ...prev, [current.id]: { state: 'idle' } }));
    }
    updateAi({
      providers: data.ai.providers.map(p => p.id === current.id ? { ...p, ...patch } : p),
    });
  }, [current, data.ai.providers, updateAi]);

  const providerNameError = (() => {
    if (!current) return '';
    const trimmed = nameDraft.trim();
    if (!trimmed) return locale === 'zh' ? '名称不能为空' : 'Name is required';
    const duplicate = data.ai.providers.some(provider => (
      provider.id !== current.id
      && provider.name.trim().toLowerCase() === trimmed.toLowerCase()
    ));
    if (duplicate) return locale === 'zh' ? '名称已存在' : 'Name already exists';
    return '';
  })();

  const commitProviderName = useCallback(() => {
    if (!current) return;
    const trimmed = nameDraft.trim();
    const duplicate = data.ai.providers.some(provider => (
      provider.id !== current.id
      && provider.name.trim().toLowerCase() === trimmed.toLowerCase()
    ));
    if (!trimmed || duplicate) {
      setNameDraft(current.name);
      return;
    }
    if (trimmed !== current.name) patchProvider({ name: trimmed });
  }, [current, data.ai.providers, nameDraft, patchProvider]);

  const handleSelectProvider = useCallback((selectedId: string) => {
    if (selectedId === 'skip') return;
    const next = resolveAiProviderSelection(data.ai, selectedId, locale);
    updateAi(next);
    setCustomFormOpen(false);
  }, [data.ai, locale, updateAi]);

  const handleProtocolChange = useCallback((protocol: ProviderId) => {
    if (!current || current.protocol === protocol) return;
    setPendingProtocol(protocol);
  }, [current]);

  const applyProtocolChange = useCallback((protocol: ProviderId) => {
    if (!current || current.protocol === protocol) return;
    const siblingNames = data.ai.providers
      .filter(provider => provider.id !== current.id)
      .map(provider => provider.name);
    const rebased = rebaseProviderProtocol(current, protocol, siblingNames, locale);
    setTestResult(prev => ({ ...prev, [current.id]: { state: 'idle' } }));
    updateAi({
      providers: data.ai.providers.map(provider => provider.id === current.id ? rebased : provider),
    });
    setPendingProtocol(null);
  }, [current, data.ai.providers, locale, updateAi]);

  // ── Env key detection ──
  const envKeyName = current ? getApiKeyEnvVar(current.protocol) : undefined;
  const activeEnvKey = envKeyName ? env[envKeyName] : false;
  const hasFallbackKey = !!preset?.apiKeyFallback;

  // ── Reset provider (clear fields to defaults) ──
  const resetProvider = useCallback(() => {
    if (!current) return;
    const defaults = PROVIDER_PRESETS[current.protocol];
    setTestResult(prev => ({ ...prev, [current.id]: { state: 'idle' } }));
    updateAi({
      providers: data.ai.providers.map(p => p.id === current.id ? {
        ...p,
        apiKey: '',
        model: '',
        baseUrl: defaults?.fixedBaseUrl ?? '',
      } : p),
    });
  }, [current, data.ai.providers, updateAi]);

  // ── Delete provider ──
  const deleteProvider = useCallback(() => {
    if (!current) return;
    const remaining = data.ai.providers.filter(p => p.id !== current.id);
    const fallbackId = remaining.length > 0 ? remaining[0].id : '';
    updateAi({
      activeProvider: fallbackId,
      providers: remaining,
    });
    setTestResult(prev => { const n = { ...prev }; delete n[current.id]; return n; });
  }, [current, data.ai.providers, updateAi]);

  // ── Save handler for the "Add Provider" form ──
  const handleSaveNew = useCallback((formProvider: Provider) => {
    const newProvider: Provider = {
      id: formProvider.id,
      name: formProvider.name,
      protocol: formProvider.protocol,
      apiKey: formProvider.apiKey,
      model: formProvider.model,
      baseUrl: formProvider.baseUrl,
    };
    updateAi({
      activeProvider: newProvider.id,
      providers: [...data.ai.providers, newProvider],
    });
    setCustomFormOpen(false);
  }, [data.ai.providers, updateAi]);

  const displayName = current?.name ?? (locale === 'zh' ? '未选择' : 'No provider');

  return (
    <div className="space-y-4">
      {/* ── Card 1: AI Provider ── */}
      <SettingCard
        icon={<Sparkles size={15} />}
        title={t.settings.ai.provider}
        description={displayName}
      >
        <ProviderSelect
          value={data.ai.activeProvider}
          onChange={handleSelectProvider}
          compact
          providerEntries={data.ai.providers}
          onAdd={() => {
            setCustomFormOpen(true);
          }}
        />

        {/* Add new provider form */}
        {customFormOpen && (
          <CustomProviderForm
            key="new"
            onSave={handleSaveNew}
            onCancel={() => setCustomFormOpen(false)}
            t={t}
            existingNames={data.ai.providers.map(p => p.name)}
          />
        )}

        {/* ── Inline config fields for the selected provider ── */}
        {!customFormOpen && current && (
          <div className="space-y-3 pt-3 border-t border-border">
            {/* Name + Protocol (inline, auto-save) */}
            <div className="grid grid-cols-2 gap-3">
              <Field label={locale === 'zh' ? '名称' : 'Name'}>
                <Input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={commitProviderName}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder={locale === 'zh' ? '输入名称' : 'Enter name'}
                />
                {providerNameError && nameDraft !== current.name && (
                  <p className="text-xs text-destructive">{providerNameError}</p>
                )}
              </Field>
              <Field label={locale === 'zh' ? '协议' : 'Protocol'}>
                <Select
                  value={current.protocol}
                  onChange={e => handleProtocolChange(e.target.value as ProviderId)}
                >
                  {ALL_PROVIDER_IDS.map(id => (
                    <option key={id} value={id}>
                      {locale === 'zh' ? PROVIDER_PRESETS[id].nameZh : PROVIDER_PRESETS[id].name}
                    </option>
                  ))}
                </Select>
                {pendingProtocol && (
                  <div className="mt-2 rounded-lg border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-3 py-2">
                    <p className="text-xs text-[var(--amber-text)]">
                      {locale === 'zh'
                        ? `切换为 ${PROVIDER_PRESETS[pendingProtocol].nameZh} 会重置此服务商的 API Key、模型和 Base URL。`
                        : `Changing to ${PROVIDER_PRESETS[pendingProtocol].name} will reset this provider's API key, model, and Base URL.`}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applyProtocolChange(pendingProtocol)}
                        className="rounded-md bg-[var(--amber)] px-2.5 py-1 text-xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {locale === 'zh' ? '确认切换' : 'Change'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingProtocol(null)}
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {locale === 'zh' ? '取消' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}
              </Field>
            </div>

            {/* API Key */}
            <Field
              label={<>{t.settings.ai.apiKey} {envKeyName && <EnvBadge overridden={env[envKeyName]} />}</>}
              hint={preset && activeEnvKey ? t.settings.ai.envFieldNote(envKeyName!) : preset && hasFallbackKey ? t.settings.ai.keyOptionalHint : undefined}
            >
              <PasswordInput
                value={current.apiKey}
                onChange={v => patchProvider({ apiKey: v })}
                placeholder="sk-..."
              />
              {preset?.signupUrl && !current.apiKey && !activeEnvKey && (
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

            {/* Base URL */}
            {(preset?.supportsBaseUrl || current.baseUrl) && (
              <Field label="Base URL">
                <Input
                  value={current.baseUrl}
                  onChange={e => patchProvider({ baseUrl: e.target.value })}
                  placeholder={preset?.fixedBaseUrl || getDefaultBaseUrl(current.protocol) || 'https://api.openai.com/v1'}
                />
              </Field>
            )}

            {/* Model */}
            <Field label={locale === 'zh' ? '模型' : 'Model'}>
              <ModelInput
                value={current.model}
                onChange={v => patchProvider({ model: v })}
                placeholder={preset?.defaultModel ?? ''}
                provider={current.protocol}
                apiKey={current.apiKey}
                envKey={!!activeEnvKey}
                baseUrl={current.baseUrl}
                supportsListModels={!!current.baseUrl?.trim() || !!preset?.supportsListModels}
                allowNoKey={!!current.baseUrl?.trim()}
                browseLabel={t.settings.ai.listModels}
                noModelsLabel={t.settings.ai.noModelsFound}
              />
            </Field>

            {/* Test & Reset & Delete */}
            <ProviderActions
              provider={current.protocol}
              result={testResult[current.id] ?? { state: 'idle' }}
              hasKey={!!current.apiKey}
              hasEnv={!!activeEnvKey}
              hasConfig={!!(current.apiKey || current.model || current.baseUrl)}
              onTest={handleTestKey}
              onReset={resetProvider}
              onDelete={deleteProvider}
              t={t}
            />
          </div>
        )}

      </SettingCard>

      {/* ── Card 2: Embedding Search ── */}
      <EmbeddingSearchCard data={data} setData={setData} t={t} />

      {/* ── Card 3: Web Search ── */}
      <WebSearchCard data={data} setData={setData} t={t} />

      {/* ── Card 4: Agent Behavior ── */}
      <AgentBehaviorCard
        agent={data.agent}
        updateAgent={updateAgent}
        t={t}
      />

      {/* ── Card 4: Display Mode ── */}
      <AskDisplayModeCard />
    </div>
  );
}
