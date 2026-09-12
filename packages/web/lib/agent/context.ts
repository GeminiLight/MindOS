/** Lightweight token estimation and Ollama context discovery; Pi owns history compaction. */
import { countCjkChars } from '@/lib/core/cjk';

/**
 * Estimate token count for a string using character-class heuristics.
 * - CJK characters: ~1.5 tokens per character (measured against cl100k_base)
 * - ASCII/Latin: ~0.25 tokens per character (1 token ≈ 4 chars)
 * This is 3-4x more accurate than naive length/4 for mixed CJK/English text.
 */
export function estimateStringTokens(text: string): number {
  const cjkCount = countCjkChars(text);
  const nonCjkCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 1.5 + nonCjkCount / 4);
}

const ollamaContextCache = new Map<string, number>();

/**
 * Query Ollama's /api/show endpoint to get the actual context window (num_ctx)
 * for a specific model. Returns undefined if the query fails or the model
 * doesn't report its context size.
 *
 * Results are cached in-memory per baseUrl+model for the process lifetime.
 */
export async function getOllamaContextWindow(
  baseUrl: string,
  modelName: string,
): Promise<number | undefined> {
  const cacheKey = `${baseUrl}::${modelName}`;
  if (ollamaContextCache.has(cacheKey)) return ollamaContextCache.get(cacheKey);

  // Ollama's /api/show endpoint is at the root, not under /v1
  const ollamaBase = baseUrl.replace(/\/v1\/?$/, '');
  try {
    const resp = await fetch(`${ollamaBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return undefined;

    const data = await resp.json() as {
      model_info?: Record<string, unknown>;
      parameters?: string;
    };

    // Method 1: model_info (structured, most reliable)
    let numCtx: number | undefined;
    if (data.model_info) {
      // Different Ollama versions use different key names
      const ctxVal = data.model_info['context_length']
        ?? data.model_info['num_ctx']
        ?? data.model_info['general.context_length'];
      if (typeof ctxVal === 'number' && ctxVal > 0) {
        numCtx = ctxVal;
      }
    }

    // Method 2: parse from parameters string (fallback)
    if (!numCtx && typeof data.parameters === 'string') {
      const match = data.parameters.match(/num_ctx\s+(\d+)/);
      if (match) numCtx = parseInt(match[1], 10);
    }

    if (numCtx && numCtx > 0) {
      ollamaContextCache.set(cacheKey, numCtx);
      return numCtx;
    }
  } catch {
    // Network error, timeout, or Ollama not running — fail silently
  }
  return undefined;
}
