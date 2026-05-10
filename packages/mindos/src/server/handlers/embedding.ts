import { json, type MindosServerResponse } from '../response.js';

export type EmbeddingStatus = {
  ready?: boolean;
  building?: boolean;
  docCount?: number;
  [key: string]: unknown;
};

export type EmbeddingServices = {
  defaultLocalModel?: string;
  localModelOptions?: unknown[];
  isLocalModelDownloaded?(model?: string): Promise<boolean>;
  downloadLocalModel?(model?: string): Promise<boolean>;
  getEmbeddingStatus?(): EmbeddingStatus;
};

export type EmbeddingPostPayload = {
  action?: unknown;
  model?: unknown;
};

const DEFAULT_LOCAL_MODEL = 'Xenova/bge-small-zh-v1.5';
const DEFAULT_LOCAL_MODEL_OPTIONS = [
  { id: 'Xenova/bge-small-zh-v1.5', label: 'BGE Small ZH (33MB)', size: '~33MB', lang: 'zh+en' },
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'MiniLM L6 (23MB)', size: '~23MB', lang: 'en' },
  { id: 'Xenova/bge-small-en-v1.5', label: 'BGE Small EN (33MB)', size: '~33MB', lang: 'en' },
];

let downloading = false;
let downloadError: string | null = null;

export async function handleEmbeddingGet(
  services: EmbeddingServices = {},
): Promise<MindosServerResponse<{ downloaded: boolean; defaultModel: string; models: unknown[] } & EmbeddingStatus>> {
  const downloaded = await isDownloaded(undefined, services);
  const status = services.getEmbeddingStatus?.() ?? {};
  return json({
    downloaded,
    defaultModel: services.defaultLocalModel ?? DEFAULT_LOCAL_MODEL,
    models: services.localModelOptions ?? DEFAULT_LOCAL_MODEL_OPTIONS,
    ...status,
  });
}

export async function handleEmbeddingPost(
  body: EmbeddingPostPayload | unknown,
  services: EmbeddingServices = {},
): Promise<MindosServerResponse<
  | { ok: true; message: string }
  | { ok: false; error: string }
  | { downloading: boolean; downloaded: boolean; error: string | null }
>> {
  const payload = body && typeof body === 'object' ? body as EmbeddingPostPayload : {};
  const action = typeof payload.action === 'string' ? payload.action : '';
  const model = typeof payload.model === 'string' && payload.model ? payload.model : undefined;

  if (action === 'download') {
    if (downloading) {
      return json({ ok: false, error: 'Download already in progress' });
    }

    const modelId = model ?? services.defaultLocalModel ?? DEFAULT_LOCAL_MODEL;
    downloading = true;
    downloadError = null;

    const download = services.downloadLocalModel ?? defaultDownloadLocalModel;
    download(modelId)
      .then((ok) => {
        downloading = false;
        if (!ok) {
          downloadError = 'Download failed. Check your network connection and try again.';
        }
      })
      .catch((error) => {
        downloading = false;
        downloadError = classifyEmbeddingDownloadError(error);
      });

    return json({ ok: true, message: `Downloading ${modelId}...` });
  }

  if (action === 'status') {
    const downloaded = await isDownloaded(model, services);
    return json({ downloading, downloaded, error: downloadError });
  }

  return json({ ok: false, error: 'Unknown action' }, { status: 400 });
}

export function classifyEmbeddingDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('timeout') || lower.includes('took too long')) {
    return 'Download timeout. Your connection may be too slow. Try again or use API mode.';
  }
  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('net::err_internet_disconnected')
  ) {
    return 'Network connection failed. Check your internet and try again.';
  }
  if (lower.includes('permission denied') || lower.includes('eacces')) {
    return 'Permission denied. Check cache directory permissions (~/.cache/huggingface/).';
  }
  if (lower.includes('npm is required')) {
    return 'npm is required to install the optional local embedding runtime. Install Node.js/npm, or use API mode.';
  }
  if (lower.includes('local embedding runtime')) {
    return 'Local embedding runtime is not installed. Click Download Model to install it, or use API embedding mode.';
  }
  if (lower.includes('disk quota') || lower.includes('no space')) {
    return 'Not enough disk space. Free up space and try again.';
  }
  return `Download failed: ${message.slice(0, 200)}`;
}

async function isDownloaded(model: string | undefined, services: EmbeddingServices): Promise<boolean> {
  const check = services.isLocalModelDownloaded ?? defaultIsLocalModelDownloaded;
  return await check(model);
}

async function defaultIsLocalModelDownloaded(): Promise<boolean> {
  return false;
}

async function defaultDownloadLocalModel(): Promise<boolean> {
  return false;
}
