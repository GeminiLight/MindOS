import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { effectiveAiConfig } from '@/lib/settings';

export function getModel() {
  const cfg = effectiveAiConfig();

  if (cfg.provider === 'openai') {
    const openai = createOpenAI({
      apiKey: cfg.openaiApiKey,
      baseURL: cfg.openaiBaseUrl || undefined,
    });
    return openai.chat(cfg.openaiModel);
  }

  const anthropic = createAnthropic({ apiKey: cfg.anthropicApiKey });
  return anthropic(cfg.anthropicModel);
}
