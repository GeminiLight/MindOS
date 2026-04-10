/**
 * Embedding provider — supports two modes:
 *
 * 1. **Local** (`provider: 'local'`): Uses @huggingface/transformers to run
 *    an ONNX embedding model in-process. Model is downloaded on first use
 *    (~30-100MB, cached to ~/.cache/huggingface/).
 *
 * 2. **API** (`provider: 'api'`): Calls an OpenAI-compatible /v1/embeddings
 *    endpoint (OpenAI, DeepSeek, Ollama, etc.).
 *
 * Config is stored in ~/.mindos/config.json under the `embedding` key.
 */

import { readSettings } from '@/lib/settings';
import type { EmbeddingConfig } from '@/lib/settings';

// ── Config ───────────────────────────────────────────────────────

/** Read embedding config from settings. Returns null if not configured or disabled. */
export function getEmbeddingConfig(): EmbeddingConfig | null {
  try {
    const s = readSettings();
    const e = s.embedding;
    if (!e || !e.enabled) return null;
    if (e.provider === 'api' && (!e.baseUrl || !e.model)) return null;
    if (e.provider === 'local' && !e.model) return null;
    return {
      enabled: true,
      provider: e.provider || 'api',
      baseUrl: (e.baseUrl || '').replace(/\/+$/, ''),
      apiKey: e.apiKey || '',
      model: e.model,
    };
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Get embeddings for an array of texts.
 * Returns Float32Array[] with one vector per input text.
 * Returns empty array on failure (graceful fallback — never throws).
 */
export async function getEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const config = getEmbeddingConfig();
  if (!config || texts.length === 0) return [];

  try {
    if (config.provider === 'local') {
      return await getLocalEmbeddings(config.model, texts);
    } else {
      return await getApiEmbeddings(config, texts);
    }
  } catch (err) {
    console.error('[embedding] Failed to get embeddings:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get embedding for a single text. Convenience wrapper.
 * Returns null on failure.
 */
export async function getEmbedding(text: string): Promise<Float32Array | null> {
  const results = await getEmbeddings([text]);
  return results.length > 0 ? results[0] : null;
}

// ── Local embedding (Hugging Face Transformers.js) ───────────────

/** Default local model — small, fast, good for Chinese+English. */
export const DEFAULT_LOCAL_MODEL = 'Xenova/bge-small-zh-v1.5';

/** Alternative local models users can pick. */
export const LOCAL_MODEL_OPTIONS = [
  { id: 'Xenova/bge-small-zh-v1.5', label: 'BGE Small ZH (33MB)', size: '~33MB', lang: 'zh+en' },
  { id: 'Xenova/all-MiniLM-L6-v2', label: 'MiniLM L6 (23MB)', size: '~23MB', lang: 'en' },
  { id: 'Xenova/bge-small-en-v1.5', label: 'BGE Small EN (33MB)', size: '~33MB', lang: 'en' },
];

/**
 * Check whether the local model is available (downloaded).
 * Checks ~/.cache/huggingface/ for the model directory.
 */
export async function isLocalModelDownloaded(modelId?: string): Promise<boolean> {
  const id = modelId || DEFAULT_LOCAL_MODEL;
  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    // Hugging Face cache uses the format: models--org--model
    const modelDir = `models--${id.replace('/', '--')}`;
    const fullPath = path.join(cacheDir, modelDir);
    return fs.existsSync(fullPath);
  } catch {
    return false;
  }
}

// Lazy-loaded pipeline singleton (heavy import, only load when needed)
let _localPipeline: any = null;
let _localModelId: string | null = null;
let _loadingPromise: Promise<any> | null = null;

/**
 * Download and initialize the local embedding model.
 * Call this explicitly before first use — allows UI to show progress.
 * Returns true on success.
 */
export async function downloadLocalModel(modelId?: string): Promise<boolean> {
  const id = modelId || DEFAULT_LOCAL_MODEL;
  try {
    console.log(`[embedding] Downloading local model: ${id}...`);
    const pipeline = await loadLocalPipeline(id);
    if (pipeline) {
      console.log(`[embedding] Local model ready: ${id}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[embedding] Download failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

async function loadLocalPipeline(modelId: string): Promise<any> {
  // Return existing if same model
  if (_localPipeline && _localModelId === modelId) return _localPipeline;

  // Wait for any in-progress load
  if (_loadingPromise && _localModelId === modelId) return _loadingPromise;

  _localModelId = modelId;
  _loadingPromise = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers');
      _localPipeline = await pipeline('feature-extraction', modelId, {
        dtype: 'fp32',
      });
      return _localPipeline;
    } catch (err) {
      _localPipeline = null;
      _localModelId = null;
      throw err;
    } finally {
      _loadingPromise = null;
    }
  })();

  return _loadingPromise;
}

/** Batch size for local model (smaller than API — limited by RAM/CPU). */
const LOCAL_BATCH_SIZE = 32;

async function getLocalEmbeddings(modelId: string, texts: string[]): Promise<Float32Array[]> {
  const pipe = await loadLocalPipeline(modelId);
  if (!pipe) return [];

  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += LOCAL_BATCH_SIZE) {
    const batch = texts.slice(i, i + LOCAL_BATCH_SIZE);

    for (const text of batch) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      // output is a Tensor — extract the Float32Array
      const data = output.data;
      results.push(new Float32Array(data));
    }
  }

  return results;
}

// ── API embedding (OpenAI-compatible) ────────────────────────────

const API_BATCH_SIZE = 100;
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

async function getApiEmbeddings(config: EmbeddingConfig, texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += API_BATCH_SIZE) {
    const batch = texts.slice(i, i + API_BATCH_SIZE);
    const batchResults = await callEmbeddingApi(config, batch);
    if (batchResults.length === 0) return [];
    results.push(...batchResults);
  }

  return results;
}

async function callEmbeddingApi(
  config: EmbeddingConfig,
  texts: string[],
): Promise<Float32Array[]> {
  const url = `${config.baseUrl}/embeddings`;
  const body = JSON.stringify({
    model: config.model,
    input: texts,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const status = res.status;
        if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
          await sleep(Math.min(retryAfter * 1000, 5000));
          continue;
        }
        const errText = await res.text().catch(() => '');
        console.error(`[embedding] API error ${status}: ${errText.slice(0, 200)}`);
        return [];
      }

      const json = await res.json() as EmbeddingApiResponse;
      if (!json.data || !Array.isArray(json.data)) {
        console.error('[embedding] Unexpected response shape');
        return [];
      }

      json.data.sort((a, b) => a.index - b.index);
      return json.data.map(d => new Float32Array(d.embedding));
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      console.error('[embedding] Request failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  return [];
}

interface EmbeddingApiResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
