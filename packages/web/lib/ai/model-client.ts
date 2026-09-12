import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createOpenAIProxyFetch } from '@geminilight/mindos/agent/mindos-pi';
import { effectiveAiConfig } from '@/lib/settings';
import {
  getDefaultBaseUrl,
  type ProviderId,
} from '@/lib/agent/providers';
import { AiTaskRunner, type AiTaskMessage, type AiTaskModelClient } from './ai-task-runner';

const OPENAI_COMPATIBLE_PROVIDERS = new Set<ProviderId>([
  'openai',
  'groq',
  'xai',
  'openrouter',
  'mistral',
  'deepseek',
  'zai',
  'zai-cn',
  'kimi-coding',
  'cerebras',
  'minimax',
  'minimax-cn',
  'huggingface',
  'ollama',
  'lm-studio',
  'vllm',
]);

const LOCAL_PROVIDERS = new Set<ProviderId>(['ollama', 'lm-studio', 'vllm']);

export function createDefaultAiTaskRunner(): AiTaskRunner {
  return new AiTaskRunner(createDefaultModelClient());
}

export function createDefaultModelClient(): AiTaskModelClient {
  return {
    async completeText(input) {
      const config = effectiveAiConfig(input.providerOverride);
      const modelName = input.modelOverride || config.model;
      const apiKey = config.apiKey;
      if (!LOCAL_PROVIDERS.has(config.provider) && !apiKey) {
        throw new Error(`AI provider ${config.provider} is missing an API key.`);
      }

      if (config.provider === 'anthropic') {
        const text = await completeAnthropic({
          apiKey,
          model: modelName,
          baseUrl: config.baseUrl,
          messages: input.messages,
          signal: input.signal,
        });
        return {
          text,
          model: {
            provider: config.provider,
            name: modelName,
          },
        };
      }

      if (OPENAI_COMPATIBLE_PROVIDERS.has(config.provider)) {
        const text = await completeOpenAICompatible({
          provider: config.provider,
          apiKey,
          model: modelName,
          baseUrl: config.baseUrl || getDefaultBaseUrl(config.provider),
          messages: input.messages,
          signal: input.signal,
        });
        return {
          text,
          model: {
            provider: config.provider,
            name: modelName,
          },
        };
      }

      throw new Error(`AI provider ${config.provider} is not supported by AiTaskRunner yet.`);
    },
  };
}

async function completeAnthropic(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  messages: AiTaskMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const system = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const messages = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: message.content,
    }));
  const client = new Anthropic({
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseURL: input.baseUrl } : {}),
  });
  const response = await client.messages.create({
    model: input.model,
    max_tokens: 4096,
    temperature: 0,
    ...(system ? { system } : {}),
    messages,
  }, {
    signal: input.signal,
  });

  return response.content
    .map((block) => block.type === 'text' ? block.text : '')
    .join('')
    .trim();
}

async function completeOpenAICompatible(input: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  messages: AiTaskMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  if (!input.baseUrl) throw new Error(`AI provider ${input.provider} is missing a base URL.`);
  const client = new OpenAI({ apiKey: input.apiKey || 'local-runtime', baseURL: input.baseUrl, maxRetries: 0, fetch: createOpenAIProxyFetch() });
  const stream = await client.chat.completions.create({ model: input.model, messages: input.messages, stream: true }, { signal: input.signal });
  let content = '';
  for await (const chunk of stream) content += chunk.choices[0]?.delta.content ?? '';
  return content.trim();
}
