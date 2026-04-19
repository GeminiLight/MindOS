'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Sparkles, Bot, Monitor, ExternalLink, RotateCcw, Trash2, X, Search, Download, Loader2, Check, Globe } from 'lucide-react';
import { toast } from '@/lib/toast';
import type { AiTabProps } from './types';
import { Field, Select, Input, PasswordInput, EnvBadge, Toggle, SettingCard, SettingRow } from './Primitives';
import { useLocale } from '@/lib/stores/locale-store';
import { type ProviderId, PROVIDER_PRESETS, ALL_PROVIDER_IDS, getApiKeyEnvVar, getDefaultBaseUrl } from '@/lib/agent/providers';
import ProviderSelect from '@/components/shared/ProviderSelect';
import ModelInput from '@/components/shared/ModelInput';
import { type Provider, generateProviderId } from '@/lib/custom-endpoints';
import { useCustomProviderForm, type TestResult } from './useCustomProviderForm';
import CustomProviderFields from './CustomProviderFields';
import { TestButton } from './TestButton';
import { apiFetch } from '@/lib/api';

const MAX_STEPS_PRESETS = [10, 20, 30, 40, 50, 999] as const;

function MaxStepsSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const isPreset = MAX_STEPS_PRESETS.includes(value as typeof MAX_STEPS_PRESETS[number]);
  const [customMode, setCustomMode] = useState(!isPreset);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={customMode ? 'custom' : String(value)}
        onChange={e => {
          const v = e.target.value;
          if (v === 'custom') {
            setCustomMode(true);
          } else {
            setCustomMode(false);
            onChange(Number(v));
          }
        }}
        className="w-28"
      >
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="30">30</option>
        <option value="40">40</option>
        <option value="50">50</option>
        <option value="999">Unlimited</option>
        <option value="custom">Custom</option>
      </Select>
      {customMode && (
        <input
          type="number"
          value={value === 999 ? '' : value}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) onChange(Math.min(999, v));
          }}
          placeholder="1-999"
          min={1}
          max={999}
          autoFocus
          className="w-20 px-2 py-1 rounded-md border border-border/60 bg-muted/50 text-sm text-foreground"
        />
      )}
    </div>
  );
}

export function AiTab({ data, setData, updateAi, updateAgent, t }: AiTabProps) {
  const { locale } = useLocale();
  const env = data.envOverrides ?? {};

  // ── Current provider from the unified array ──
  const current = data.ai.providers.find(p => p.id === data.ai.activeProvider);
  const preset = current ? PROVIDER_PRESETS[current.protocol] : null;

  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const okTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevProviderRef = useRef(data.ai.activeProvider);

  useEffect(() => {
    if (prevProviderRef.current !== data.ai.activeProvider) {
      prevProviderRef.current = data.ai.activeProvider;
      setTestResult({});
      if (okTimerRef.current) { clearTimeout(okTimerRef.current); okTimerRef.current = undefined; }
    }
  }, [data.ai.activeProvider]);

  useEffect(() => () => { if (okTimerRef.current) clearTimeout(okTimerRef.current); }, []);

  useEffect(() => {
    const v = data.agent?.reconnectRetries ?? 3;
    try { localStorage.setItem('mindos-reconnect-retries', String(v)); } catch (err) { console.warn("[AiTab] localStorage setItem reconnectRetries failed:", err); }
  }, [data.agent?.reconnectRetries]);

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
    // The form uses `protocol` directly now (no mapping needed)
    const newProvider: Provider = {
      id: formProvider.id || generateProviderId(),
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
          value={data.ai.activeProvider as ProviderId}
          onChange={id => {
            if (id !== 'skip') updateAi({ activeProvider: id });
            setCustomFormOpen(false);
          }}
          compact
          customProviders={data.ai.providers}
          onAdd={() => {
            // Open form pre-filled with OpenAI defaults
            const defaultId: ProviderId = 'openai';
            const p = PROVIDER_PRESETS[defaultId];
            const baseName = locale === 'zh' ? p.nameZh : p.name;
            const names = new Set(data.ai.providers.map(cp => cp.name.toLowerCase()));
            let finalName = baseName;
            if (names.has(finalName.toLowerCase())) {
              let n = 2;
              while (names.has(`${baseName} (${n})`.toLowerCase())) n++;
              finalName = `${baseName} (${n})`;
            }
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
                  value={current.name}
                  onChange={e => patchProvider({ name: e.target.value })}
                  placeholder={locale === 'zh' ? '输入名称' : 'Enter name'}
                />
              </Field>
              <Field label={locale === 'zh' ? '协议' : 'Protocol'}>
                <Select
                  value={current.protocol}
                  onChange={e => patchProvider({ protocol: e.target.value as ProviderId })}
                >
                  {ALL_PROVIDER_IDS.map(id => (
                    <option key={id} value={id}>
                      {locale === 'zh' ? PROVIDER_PRESETS[id].nameZh : PROVIDER_PRESETS[id].name}
                    </option>
                  ))}
                </Select>
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
      <SettingCard
        icon={<Bot size={15} />}
        title={t.settings.agent.title}
        description={t.settings.agent.subtitle ?? 'Configure how the AI agent operates'}
      >
        <SettingRow label={t.settings.agent.maxSteps} hint={t.settings.agent.maxStepsHint}>
          <MaxStepsSelect value={data.agent?.maxSteps ?? 20} onChange={v => updateAgent({ maxSteps: v })} />
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

      {/* ── Card 4: Display Mode ── */}
      <AskDisplayMode />
    </div>
  );
}

/* ── Provider Actions: Test + Reset + Delete ── */

function ProviderActions({
  provider, result, hasKey, hasEnv, hasConfig, onTest, onReset, onDelete, t,
}: {
  provider: ProviderId;
  result: TestResult;
  hasKey: boolean;
  hasEnv: boolean;
  hasConfig: boolean;
  onTest: () => void;
  onReset?: () => void;
  onDelete?: () => void;
  t: AiTabProps['t'];
}) {
  const [confirmAction, setConfirmAction] = useState<'reset' | 'delete' | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasFallback = !!PROVIDER_PRESETS[provider]?.apiKeyFallback;
  const canTest = hasKey || hasEnv || hasFallback;

  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);

  const startConfirm = (action: 'reset' | 'delete') => {
    if (confirmAction === action) {
      if (action === 'reset') onReset?.(); else onDelete?.();
      setConfirmAction(null);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    } else {
      setConfirmAction(action);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmAction(null), 3000);
    }
  };

  const { locale } = useLocale();

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <TestButton result={result} disabled={!canTest} onTest={onTest} t={t} />

        <div className="flex items-center gap-1">
          {/* Reset */}
          {onReset && hasConfig && (
            <button
              type="button"
              onClick={() => startConfirm('reset')}
              onBlur={() => { if (confirmAction === 'reset') { setConfirmAction(null); if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); } }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                confirmAction === 'reset'
                  ? 'bg-destructive/10 text-destructive border border-destructive/25 font-medium'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <RotateCcw size={12} />
              {confirmAction === 'reset'
                ? (locale === 'zh' ? '确认重置？' : 'Confirm?')
                : (locale === 'zh' ? '重置' : 'Reset')}
            </button>
          )}
          {/* Delete */}
          {onDelete && (
            <button
              type="button"
              onClick={() => startConfirm('delete')}
              onBlur={() => { if (confirmAction === 'delete') { setConfirmAction(null); if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); } }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                confirmAction === 'delete'
                  ? 'bg-destructive/10 text-destructive border border-destructive/25 font-medium'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Trash2 size={12} />
              {confirmAction === 'delete'
                ? (locale === 'zh' ? '确认删除？' : 'Confirm?')
                : (locale === 'zh' ? '删除' : 'Delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Inline Custom Provider Form (uses shared hook + fields) ── */

function CustomProviderForm({
  initial, onSave, onCancel, onDelete, t, existingNames,
}: {
  initial?: Provider;
  onSave: (provider: Provider) => void;
  onCancel: () => void;
  onDelete?: () => void;
  t: AiTabProps['t'];
  existingNames: string[];
}) {
  const { locale } = useLocale();
  const form = useCustomProviderForm({ initial, onSave, locale, existingNames });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }, []);

  const formTitle = initial?.id
    ? (locale === 'zh' ? '编辑 Provider' : 'Edit Provider')
    : (locale === 'zh' ? '添加 Provider' : 'Add Provider');

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

          {/* Delete — only when editing an existing provider */}
          {onDelete && initial?.id && (
            <button
              type="button"
              onClick={() => {
                if (confirmDelete) {
                  onDelete();
                  if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                } else {
                  setConfirmDelete(true);
                  deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
                }
              }}
              onBlur={() => { setConfirmDelete(false); if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                confirmDelete
                  ? 'bg-destructive/10 text-destructive border border-destructive/25 font-medium'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Trash2 size={12} />
              {confirmDelete
                ? (locale === 'zh' ? '确认删除？' : 'Confirm?')
                : (locale === 'zh' ? '删除' : 'Delete')}
            </button>
          )}

          <div className="flex-1">
            {form.isDuplicateName && (
              <span className="text-2xs text-destructive pl-2">
                {locale === 'zh' ? '名称已存在' : 'Name already exists'}
              </span>
            )}
            {!form.isDuplicateName && !form.canSave && missingFields.length > 0 && (
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

/* ── Embedding Search Card ── */

const EMBEDDING_API_PRESETS = [
  { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', badge: 'free' as const },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', badge: null },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-embed', badge: null },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text', badge: 'local' as const },
];

const EMBEDDING_LOCAL_MODELS = [
  { id: 'Xenova/bge-small-zh-v1.5', label: 'BGE Small ZH (33MB)', desc: 'Chinese + English' },
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'MiniLM L6 (23MB)', desc: 'English only' },
  { id: 'Xenova/bge-small-en-v1.5', label: 'BGE Small EN (33MB)', desc: 'English only' },
];

function EmbeddingSearchCard({ data, setData, t }: {
  data: AiTabProps['data'];
  setData: AiTabProps['setData'];
  t: AiTabProps['t'];
}) {
  const { locale } = useLocale();
  const e = t.settings.embedding ?? {} as Record<string, unknown>;
  const embeddingData = data.embedding ?? { enabled: false, provider: 'local' as const, baseUrl: '', apiKey: '', model: '' };
  const embeddingStatus = data.embeddingStatus ?? { enabled: false, ready: false, building: false, docCount: 0 };
  const embeddingProvider = embeddingData.provider || 'local';

  const [localModelDownloaded, setLocalModelDownloaded] = useState<boolean | null>(null);
  // Download state: 'idle' | 'starting' | 'downloading' | 'error'
  const [downloadState, setDownloadState] = useState<'idle' | 'starting' | 'downloading' | 'error'>('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (embeddingData.enabled && embeddingProvider === 'local') {
      apiFetch<{ downloaded: boolean }>('/api/embedding')
        .then(d => setLocalModelDownloaded(d.downloaded))
        .catch(() => setLocalModelDownloaded(false));
    }
  }, [embeddingData.enabled, embeddingProvider]);

  useEffect(() => {
    if (downloadState !== 'downloading') return;
    const id = setInterval(() => {
      apiFetch<{ downloading: boolean; downloaded: boolean; error: string | null }>('/api/embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      }).then(d => {
        if (d.downloaded) {
          setLocalModelDownloaded(true);
          setDownloadState('idle');
          toast.success?.(e.modelReady as string ?? 'Model downloaded') ?? toast(e.modelReady as string ?? 'Model downloaded');
        }
        if (d.error) {
          setDownloadState('error');
          setDownloadError(d.error);
          toast.error?.(d.error) ?? toast(d.error);
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [downloadState, e.modelReady]);

  const handleDownloadModel = useCallback(() => {
    // Immediate visual feedback
    setDownloadState('starting');
    setDownloadError(null);
    
    apiFetch<{ ok: boolean; error?: string }>('/api/embedding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download', model: embeddingData.model || undefined }),
    }).then(res => {
      if (res.ok) {
        // Request accepted, switch to downloading state
        setDownloadState('downloading');
      } else {
        // Immediate error from server
        setDownloadState('error');
        setDownloadError(res.error ?? 'Download request failed');
      }
    }).catch(err => {
      // Network error
      setDownloadState('error');
      setDownloadError(err instanceof Error ? err.message : 'Network error');
    });
  }, [embeddingData.model]);

  const handleRetry = useCallback(() => {
    setDownloadState('idle');
    setDownloadError(null);
  }, []);

  return (
    <SettingCard
      icon={<Search size={15} />}
      title={e.title as string ?? 'Embedding Search'}
      description={e.description as string ?? 'Semantic search with vector embeddings.'}
    >
      <SettingRow label={e.enable as string ?? 'Enable embedding search'} hint={e.enableHint as string}>
        <Toggle
          checked={embeddingData.enabled}
          onChange={() => {
            setData(d => d ? { ...d, embedding: { ...embeddingData, enabled: !embeddingData.enabled } } : d);
          }}
        />
      </SettingRow>

      {embeddingData.enabled && (
        <>
          {/* Provider toggle: Local vs API */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setData(d => d ? { ...d, embedding: { ...embeddingData, provider: 'local', model: embeddingData.model || 'Xenova/bge-small-zh-v1.5' } } : d)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors text-center ${
                embeddingProvider === 'local'
                  ? 'border-[var(--amber)] text-[var(--amber)] bg-[var(--amber)]/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <span className="font-medium">{e.providerLocal as string ?? 'Local'} ({e.providerLocalFree as string ?? 'Free'})</span>
              <span className="block text-xs opacity-70 mt-0.5">{e.providerLocalDesc as string ?? 'Runs on your machine'}</span>
            </button>
            <button
              type="button"
              onClick={() => setData(d => d ? { ...d, embedding: { ...embeddingData, provider: 'api', model: embeddingData.model || 'BAAI/bge-m3', baseUrl: embeddingData.baseUrl || 'https://api.siliconflow.cn/v1' } } : d)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors text-center ${
                embeddingProvider === 'api'
                  ? 'border-[var(--amber)] text-[var(--amber)] bg-[var(--amber)]/10'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <span className="font-medium">{e.providerApi as string ?? 'API'}</span>
              <span className="block text-xs opacity-70 mt-0.5">{e.providerApiDesc as string ?? 'OpenAI, DeepSeek, Ollama, etc.'}</span>
            </button>
          </div>

          {/* Local provider UI */}
          {embeddingProvider === 'local' && (
            <>
              <Field label={e.model as string ?? 'Model'} hint={e.modelHint as string}>
                <div className="space-y-1.5">
                  {EMBEDDING_LOCAL_MODELS.map(m => (
                    <label
                      key={m.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        embeddingData.model === m.id
                          ? 'border-[var(--amber)] bg-[var(--amber)]/5'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name="local-model"
                        checked={embeddingData.model === m.id}
                        onChange={() => setData(d => d ? { ...d, embedding: { ...embeddingData, model: m.id } } : d)}
                        className="accent-[var(--amber)]"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground">{m.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{m.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </Field>

              {localModelDownloaded === false && downloadState === 'idle' && (
                <button
                  type="button"
                  onClick={handleDownloadModel}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity"
                >
                  <Download size={14} />
                  {e.downloadModel as string ?? 'Download Model'}
                </button>
              )}
              {downloadState === 'starting' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{e.starting as string ?? 'Starting download...'}</span>
                </div>
              )}
              {downloadState === 'downloading' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{e.downloading as string ?? 'Downloading model...'}</span>
                </div>
              )}
              {downloadState === 'error' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <X size={14} />
                    <span>{downloadError ?? 'Download failed'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {e.downloadFailedHint as string ?? 'If download keeps failing, try API mode or set HF_ENDPOINT=https://hf-mirror.com'}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    <RotateCcw size={12} />
                    {e.retry as string ?? 'Retry'}
                  </button>
                </div>
              )}
              {localModelDownloaded === true && downloadState === 'idle' && (
                <div className="flex items-center gap-2 text-xs text-success">
                  <Check size={12} />
                  <span>{e.modelReady as string ?? 'Model ready'}</span>
                </div>
              )}
            </>
          )}

          {/* API provider UI */}
          {embeddingProvider === 'api' && (
            <>
              {/* Preset quick-select: card-style buttons with badges */}
              <div className="grid grid-cols-2 gap-2">
                {EMBEDDING_API_PRESETS.map(p => {
                  const isActive = embeddingData.baseUrl === p.baseUrl;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setData(d => d ? { ...d, embedding: { ...embeddingData, baseUrl: p.baseUrl, model: p.model } } : d);
                      }}
                      className={`relative px-3 py-2 text-left text-sm rounded-lg border transition-colors ${
                        isActive
                          ? 'border-[var(--amber)] bg-[var(--amber)]/5'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span className={`font-medium ${isActive ? 'text-[var(--amber)]' : 'text-foreground'}`}>
                        {p.label}
                      </span>
                      {p.badge && (
                        <span className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 text-2xs rounded-full font-medium ${
                          p.badge === 'free'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        }`}>
                          {p.badge === 'free' ? (locale === 'zh' ? '免费' : 'Free') : (locale === 'zh' ? '本地' : 'Local')}
                        </span>
                      )}
                      <span className="block text-2xs text-muted-foreground mt-0.5 truncate">
                        {p.model}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* SiliconFlow recommendation hint */}
              {!embeddingData.baseUrl && (
                <p className="text-xs text-muted-foreground">
                  {locale === 'zh'
                    ? '推荐使用硅基流动 (SiliconFlow)，注册即可免费使用嵌入模型。'
                    : 'SiliconFlow recommended — free embedding models with registration.'}
                </p>
              )}

              <Field label={e.baseUrl as string ?? 'Base URL'} hint={e.baseUrlHint as string}>
                <Input
                  value={embeddingData.baseUrl}
                  onChange={ev => setData(d => d ? { ...d, embedding: { ...embeddingData, baseUrl: ev.target.value } } : d)}
                  placeholder="https://api.siliconflow.cn/v1"
                />
              </Field>

              <Field label={e.apiKey as string ?? 'API Key'} hint={
                embeddingData.baseUrl?.includes('localhost') || embeddingData.baseUrl?.includes('127.0.0.1')
                  ? (e.apiKeyHintLocal as string ?? (locale === 'zh' ? '本地服务可留空' : 'Leave empty for local services'))
                  : (e.apiKeyHint as string ?? (locale === 'zh' ? '在服务商网站获取 API Key' : 'Get your API key from the provider'))
              }>
                <PasswordInput
                  value={embeddingData.apiKey}
                  onChange={v => setData(d => d ? { ...d, embedding: { ...embeddingData, apiKey: v } } : d)}
                  placeholder="sk-..."
                />
              </Field>

              <Field label={e.model as string ?? 'Model'} hint={e.modelName as string}>
                <Input
                  value={embeddingData.model}
                  onChange={ev => setData(d => d ? { ...d, embedding: { ...embeddingData, model: ev.target.value } } : d)}
                  placeholder="BAAI/bge-m3"
                />
              </Field>
            </>
          )}

          {/* Index status */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            {embeddingStatus.building ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>{e.indexBuilding as string ?? 'Building embedding index...'}</span>
              </>
            ) : embeddingStatus.ready ? (
              <>
                <Check size={12} className="text-success" />
                <span>{typeof e.indexReady === 'function' ? (e.indexReady as (n: number) => string)(embeddingStatus.docCount) : `${embeddingStatus.docCount} documents indexed`}</span>
              </>
            ) : (
              <span>{e.indexPending as string ?? 'Index will be built on first search'}</span>
            )}
          </div>
        </>
      )}
    </SettingCard>
  );
}

/* ── Web Search Card (pi-web-access config → ~/.mindos/web-search.json) ── */

const WEB_SEARCH_PROVIDERS = [
  { id: 'auto', labelKey: 'providerAuto', descKey: 'providerAutoDesc' },
  { id: 'exa', labelKey: 'providerExa', descKey: 'providerExaDesc' },
  { id: 'perplexity', labelKey: 'providerPerplexity', descKey: 'providerPerplexityDesc' },
  { id: 'gemini', labelKey: 'providerGemini', descKey: 'providerGeminiDesc' },
];

const WEB_SEARCH_KEY_FIELDS = [
  { key: 'exaApiKey' as const, labelKey: 'exaApiKey', placeholder: 'exa-...' },
  { key: 'perplexityApiKey' as const, labelKey: 'perplexityApiKey', placeholder: 'pplx-...' },
  { key: 'geminiApiKey' as const, labelKey: 'geminiApiKey', placeholder: 'AIza...' },
];

function WebSearchCard({ data, setData, t }: {
  data: AiTabProps['data'];
  setData: AiTabProps['setData'];
  t: AiTabProps['t'];
}) {
  const w = t.settings.webSearch ?? {} as Record<string, unknown>;
  const wsData = data.webSearch ?? { provider: 'auto', exaApiKey: '', perplexityApiKey: '', geminiApiKey: '' };
  const activeProvider = wsData.provider || 'auto';

  return (
    <SettingCard
      icon={<Globe size={15} />}
      title={w.title as string ?? 'Web Search'}
      description={w.description as string ?? 'Configure search providers.'}
    >
      {/* Provider selector */}
      <div className="flex gap-2 flex-wrap">
        {WEB_SEARCH_PROVIDERS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setData(d => d ? { ...d, webSearch: { ...wsData, provider: p.id } } : d);
            }}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              activeProvider === p.id
                ? 'border-[var(--amber)] text-[var(--amber)] bg-[var(--amber)]/10'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {(w as Record<string, unknown>)[p.labelKey] as string ?? p.id}
          </button>
        ))}
      </div>

      {/* Provider description */}
      {(() => {
        const prov = WEB_SEARCH_PROVIDERS.find(p => p.id === activeProvider);
        if (!prov) return null;
        const desc = (w as Record<string, unknown>)[prov.descKey] as string;
        return desc ? (
          <p className="text-xs text-muted-foreground">{desc}</p>
        ) : null;
      })()}

      {/* API Key fields */}
      {WEB_SEARCH_KEY_FIELDS.map(f => (
        <Field key={f.key} label={(w as Record<string, unknown>)[f.labelKey] as string ?? f.key} hint={w.apiKeyHint as string}>
          <PasswordInput
            value={(wsData as Record<string, string>)[f.key] ?? ''}
            onChange={v => setData(d => d ? { ...d, webSearch: { ...wsData, [f.key]: v } } : d)}
            placeholder={f.placeholder}
          />
        </Field>
      ))}

      <p className="text-xs text-muted-foreground">
        {w.noKeysHint as string ?? 'Works without API keys via Exa MCP (zero-config).'}
      </p>
    </SettingCard>
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
