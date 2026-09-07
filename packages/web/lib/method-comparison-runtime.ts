import type { MethodComparisonRequest } from '@geminilight/mindos/knowledge';
import { effectiveAiConfig } from '@/lib/settings';
import { getDefaultBaseUrl } from '@/lib/agent/providers';
import { configuredStudyRuntime } from '@/lib/study-coaching-config';
/** Public configuration only; credential material never leaves configuredStudyRuntime. */
export function currentComparisonRuntime(): MethodComparisonRequest['runtime'] | null {
  try {
    const c = effectiveAiConfig();
    const endpoint = (c.baseUrl || getDefaultBaseUrl(c.provider)).replace(/\/+$/, '') + '/chat/completions';
    const u = new URL(endpoint);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return null;
    const runtime: MethodComparisonRequest['runtime'] = { adapter: 'isolated-chat-v1', provider: c.provider, model: c.model, endpoint, temperature: c.providerEntry?.temperature ?? 0, maxOutputTokens: c.providerEntry?.studyMaxOutputTokens ?? 1024, tools: [] };
    return configuredStudyRuntime(runtime) ? runtime : null;
  } catch { return null; }
}
