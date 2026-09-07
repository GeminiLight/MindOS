import { effectiveAiConfig } from '@/lib/settings';
import { getDefaultBaseUrl } from '@/lib/agent/providers';
const supported = new Set(['openai', 'groq', 'xai', 'openrouter', 'mistral', 'deepseek', 'zai', 'zai-cn', 'kimi-coding', 'cerebras', 'minimax', 'minimax-cn', 'huggingface', 'ollama', 'lm-studio', 'vllm']);
const local = new Set(['ollama', 'lm-studio', 'vllm']);
type ExpectedRuntime = { provider: string; model: string; endpoint?: string; temperature?: number };
/** Returns credentials only to the server executor. Never serialize this result. */
export function configuredStudyRuntime(runtime: ExpectedRuntime) {
  if (!supported.has(runtime.provider)) return null;
  const config = effectiveAiConfig(runtime.provider);
  const endpoint = (config.baseUrl || getDefaultBaseUrl(config.provider)).replace(/\/+$/, '') + '/chat/completions';
  if ((runtime.temperature ?? 0) !== (config.providerEntry?.temperature ?? 0) || config.provider !== runtime.provider || config.model !== runtime.model || endpoint !== runtime.endpoint || (!local.has(config.provider) && !config.apiKey)) return null;
  return { endpoint, apiKey: config.apiKey };
}
/** Local configuration comparison only; does not claim a successful provider run. */
export function studyExecutionReadiness(protocol: { execution?: unknown; conditions: { id: string; expectedRuntime: ExpectedRuntime }[] }) {
  return protocol.execution ? protocol.conditions.map(condition => {
    let configured = false;
    try { configured = !!configuredStudyRuntime(condition.expectedRuntime); } catch { /* Missing configuration remains unready. */ }
    return { conditionId: condition.id, configured };
  }) : [];
}
