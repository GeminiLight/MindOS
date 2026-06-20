'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import type { AiTabProps } from '../types';
import { Field, Input, PasswordInput, SettingCard, SettingRow, Toggle } from '../Primitives';
import { Button } from '@/components/ui/button';

type EmbeddingSettings = NonNullable<AiTabProps['data']['embedding']>;
type LocalModelOption = {
  id: string;
  label: string;
  desc: string;
};

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

const DEFAULT_EMBEDDING_API_PRESET = EMBEDDING_API_PRESETS[0];
const FALLBACK_LOCAL_MODEL = EMBEDDING_LOCAL_MODELS[0].id;

const EMPTY_EMBEDDING: EmbeddingSettings = {
  enabled: false,
  provider: 'local',
  baseUrl: '',
  apiKey: '',
  model: '',
};

function normalizeEmbedding(
  embedding: AiTabProps['data']['embedding'] | undefined,
  defaultLocalModel: string,
): EmbeddingSettings {
  const provider = embedding?.provider === 'api' ? 'api' : 'local';
  return {
    ...EMPTY_EMBEDDING,
    ...embedding,
    provider,
    model: provider === 'local' && embedding?.enabled && !embedding?.model
      ? defaultLocalModel
      : (embedding?.model ?? ''),
  };
}

function normalizeLocalModels(raw: unknown): LocalModelOption[] {
  if (!Array.isArray(raw)) return EMBEDDING_LOCAL_MODELS;
  const models = raw
    .map((item): LocalModelOption | null => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, unknown>;
      if (typeof source.id !== 'string' || !source.id.trim()) return null;
      const label = typeof source.label === 'string' && source.label.trim()
        ? source.label
        : source.id;
      const details = [source.lang, source.size]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' · ');
      return {
        id: source.id,
        label,
        desc: typeof source.desc === 'string' && source.desc.trim()
          ? source.desc
          : details,
      };
    })
    .filter((model): model is LocalModelOption => !!model);

  return models.length > 0 ? models : EMBEDDING_LOCAL_MODELS;
}

function notifySuccess(message: string) {
  if (toast.success) {
    toast.success(message);
  } else {
    toast(message);
  }
}

function notifyError(message: string) {
  if (toast.error) {
    toast.error(message);
  } else {
    toast(message, { type: 'error' });
  }
}

export function EmbeddingSearchCard({ data, setData, t }: {
  data: AiTabProps['data'];
  setData: AiTabProps['setData'];
  t: AiTabProps['t'];
}) {
  const { locale } = useLocale();
  const e = t.settings.embedding ?? {} as Record<string, unknown>;
  const [defaultLocalModel, setDefaultLocalModel] = useState(FALLBACK_LOCAL_MODEL);
  const [localModels, setLocalModels] = useState<LocalModelOption[]>(EMBEDDING_LOCAL_MODELS);
  const embeddingData = useMemo(
    () => normalizeEmbedding(data.embedding, defaultLocalModel),
    [data.embedding, defaultLocalModel],
  );
  const embeddingStatus = data.embeddingStatus ?? { enabled: false, ready: false, building: false, docCount: 0 };
  const embeddingProvider = embeddingData.provider || 'local';
  const selectedLocalModel = embeddingProvider === 'local'
    ? (embeddingData.model || defaultLocalModel)
    : defaultLocalModel;

  const [localModelDownloaded, setLocalModelDownloaded] = useState<boolean | null>(null);
  const [downloadState, setDownloadState] = useState<'idle' | 'starting' | 'downloading' | 'error'>('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);

  const patchEmbedding = useCallback((
    patch: Partial<EmbeddingSettings> | ((current: EmbeddingSettings) => Partial<EmbeddingSettings>),
  ) => {
    setData(current => {
      if (!current) return current;
      const previous = normalizeEmbedding(current.embedding, defaultLocalModel);
      const nextPatch = typeof patch === 'function' ? patch(previous) : patch;
      return {
        ...current,
        embedding: normalizeEmbedding({ ...previous, ...nextPatch }, defaultLocalModel),
      };
    });
  }, [defaultLocalModel, setData]);

  useEffect(() => {
    if (!embeddingData.enabled || embeddingProvider !== 'local') return;
    let cancelled = false;
    apiFetch<{ defaultModel?: string; models?: unknown[] }>('/api/embedding')
      .then(response => {
        if (cancelled) return;
        if (typeof response.defaultModel === 'string' && response.defaultModel.trim()) {
          setDefaultLocalModel(response.defaultModel);
        }
        setLocalModels(normalizeLocalModels(response.models));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [embeddingData.enabled, embeddingProvider]);

  useEffect(() => {
    if (!embeddingData.enabled || embeddingProvider !== 'local') return;
    let cancelled = false;
    const clearId = window.setTimeout(() => {
      if (!cancelled) setLocalModelDownloaded(null);
    }, 0);
    apiFetch<{ downloading: boolean; downloaded: boolean; error: string | null }>('/api/embedding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', model: selectedLocalModel }),
    }).then(response => {
      if (cancelled) return;
      setLocalModelDownloaded(response.downloaded);
    }).catch(() => {
      if (!cancelled) setLocalModelDownloaded(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(clearId);
    };
  }, [embeddingData.enabled, embeddingProvider, selectedLocalModel]);

  useEffect(() => {
    if (downloadState !== 'downloading') return;
    const model = downloadModelId || selectedLocalModel;
    const id = setInterval(() => {
      apiFetch<{ downloading: boolean; downloaded: boolean; error: string | null }>('/api/embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', model }),
      }).then(d => {
        if (d.downloaded) {
          if (model === selectedLocalModel) setLocalModelDownloaded(true);
          setDownloadState('idle');
          setDownloadModelId(null);
          notifySuccess(e.modelReady as string ?? 'Model downloaded');
        }
        if (d.error) {
          setDownloadState('error');
          setDownloadError(d.error);
          setDownloadModelId(null);
          notifyError(d.error);
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [downloadModelId, downloadState, e.modelReady, selectedLocalModel]);

  const handleDownloadModel = useCallback(() => {
    const model = selectedLocalModel;
    setDownloadState('starting');
    setDownloadError(null);
    setDownloadModelId(model);

    apiFetch<{ ok: boolean; error?: string }>('/api/embedding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download', model }),
    }).then(res => {
      if (res.ok) {
        setDownloadState('downloading');
      } else {
        setDownloadState('error');
        setDownloadError(res.error ?? 'Download request failed');
        setDownloadModelId(null);
      }
    }).catch(err => {
      setDownloadState('error');
      setDownloadError(err instanceof Error ? err.message : 'Network error');
      setDownloadModelId(null);
    });
  }, [selectedLocalModel]);

  const handleRetry = useCallback(() => {
    setDownloadState('idle');
    setDownloadError(null);
    setDownloadModelId(null);
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
            patchEmbedding(current => {
              const enabled = !current.enabled;
              if (!enabled) return { enabled };
              if (current.provider === 'api') {
                return {
                  enabled,
                  baseUrl: current.baseUrl || DEFAULT_EMBEDDING_API_PRESET.baseUrl,
                  model: current.model || DEFAULT_EMBEDDING_API_PRESET.model,
                };
              }
              return {
                enabled,
                model: current.model || defaultLocalModel,
              };
            });
          }}
        />
      </SettingRow>

      {embeddingData.enabled && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patchEmbedding(current => ({
                provider: 'local',
                model: current.provider === 'local' ? (current.model || defaultLocalModel) : defaultLocalModel,
              }))}
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
              onClick={() => patchEmbedding(current => ({
                provider: 'api',
                model: current.provider === 'api' ? (current.model || DEFAULT_EMBEDDING_API_PRESET.model) : DEFAULT_EMBEDDING_API_PRESET.model,
                baseUrl: current.baseUrl || DEFAULT_EMBEDDING_API_PRESET.baseUrl,
              }))}
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

          {embeddingProvider === 'local' && (
            <>
              <Field label={e.model as string ?? 'Model'} hint={e.modelHint as string}>
                <div className="space-y-1.5">
                  {localModels.map(model => (
                    <label
                      key={model.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedLocalModel === model.id
                          ? 'border-[var(--amber)] bg-[var(--amber)]/5'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name="local-model"
                        checked={selectedLocalModel === model.id}
                        onChange={() => patchEmbedding({ model: model.id })}
                        className="accent-[var(--amber)]"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground">{model.label}</span>
                        {model.desc && <span className="ml-2 text-xs text-muted-foreground">{model.desc}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </Field>

              {localModelDownloaded === false && downloadState === 'idle' && (
                <Button
                  variant="amber"
                  size="lg"
                  type="button"
                  onClick={handleDownloadModel}
                  className="gap-2"
                >
                  <Download size={14} />
                  {e.downloadModel as string ?? 'Install Runtime & Download Model'}
                </Button>
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
                    {e.downloadFailedHint as string ?? 'If install or download keeps failing, try API mode or set HF_ENDPOINT=https://hf-mirror.com'}
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

          {embeddingProvider === 'api' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {EMBEDDING_API_PRESETS.map(preset => {
                  const isActive = embeddingData.baseUrl === preset.baseUrl;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        patchEmbedding({ baseUrl: preset.baseUrl, model: preset.model });
                      }}
                      className={`relative px-3 py-2 text-left text-sm rounded-lg border transition-colors ${
                        isActive
                          ? 'border-[var(--amber)] bg-[var(--amber)]/5'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span className={`font-medium ${isActive ? 'text-[var(--amber)]' : 'text-foreground'}`}>
                        {preset.label}
                      </span>
                      {preset.badge && (
                        <span className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 text-2xs rounded-full font-medium ${
                          preset.badge === 'free'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        }`}>
                          {preset.badge === 'free' ? (locale === 'zh' ? '免费' : 'Free') : (locale === 'zh' ? '本地' : 'Local')}
                        </span>
                      )}
                      <span className="block text-2xs text-muted-foreground mt-0.5 truncate">
                        {preset.model}
                      </span>
                    </button>
                  );
                })}
              </div>

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
                  onChange={event => patchEmbedding({ baseUrl: event.target.value })}
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
                  onChange={value => patchEmbedding({ apiKey: value })}
                  placeholder="sk-..."
                />
              </Field>

              <Field label={e.model as string ?? 'Model'} hint={e.modelName as string}>
                <Input
                  value={embeddingData.model}
                  onChange={event => patchEmbedding({ model: event.target.value })}
                  placeholder="BAAI/bge-m3"
                />
              </Field>
            </>
          )}

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
