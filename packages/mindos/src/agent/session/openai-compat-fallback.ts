import type { MindosExecutableTool } from '../tool/executable-tool.js';
import {
  safeParseMindosJsonObject,
  sanitizeToolArgs,
  sanitizeToolOutput,
} from './tool-event-safety.js';

export type MindosOpenAIMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

type MindosOpenAIChunkToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type MindosOpenAIToolCall = {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

export type MindosOpenAICompatChoice = {
  message: {
    role: string;
    content: unknown;
    tool_calls?: unknown;
  };
  finish_reason: string;
};

export type MindosOpenAICompatCompletion = {
  choices: MindosOpenAICompatChoice[];
};

export type MindosOpenAICompatFallbackEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_delta'; toolCallId: string; toolName?: string; delta: string }
  | { type: 'tool_end'; toolCallId: string; toolName?: string; output: string; isError: boolean };

export type MindosOpenAICompatFallbackOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  historyMessages: unknown[];
  userContent: string;
  tools: MindosExecutableTool[];
  send(event: MindosOpenAICompatFallbackEvent): void;
  signal: AbortSignal;
  maxSteps: number;
  fetch?: typeof fetch;
  chunkDelayMs?: number;
  /**
   * Provider transport preference for the OpenAI-compatible fallback request.
   *
   * Defaults to false: the fallback owns its own request/parse/tool loop, so it
   * should ask OpenAI-compatible providers for JSON and only treat SSE as a
   * compatibility shape when a proxy ignores stream:false.
   */
  requestStream?: boolean;
};

export type MindosNonStreamingFallbackOptions = Omit<MindosOpenAICompatFallbackOptions, 'requestStream'> & {
  requestStream?: false;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildMindosCompatEndpointCandidates(baseUrl: string, endpointPath: string, apiType: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const cleanPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const hasVersionPrefix = /\/v\d+(?:$|\/)/.test(base);
  const candidates = new Set<string>();

  candidates.add(`${base}${cleanPath}`);

  if (!hasVersionPrefix && (
    apiType === 'openai-completions'
    || apiType === 'openai-responses'
    || apiType === 'anthropic-messages'
  )) {
    candidates.add(`${base}/v1${cleanPath}`);
  }

  return Array.from(candidates);
}

export function reassembleMindosOpenAISse(sseText: string): MindosOpenAICompatCompletion {
  const lines = sseText.split('\n');
  let content = '';
  let role = 'assistant';
  let finishReason = 'stop';
  const toolCalls = new Map<number, MindosOpenAIToolCall>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    const chunk = parseUnknownJson(payload);
    if (!isRecord(chunk)) continue;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const firstChoice = choices[0];
    if (!isRecord(firstChoice)) continue;
    const delta = isRecord(firstChoice.delta)
      ? firstChoice.delta
      : isRecord(firstChoice.message)
        ? firstChoice.message
        : undefined;
    if (!delta) continue;

    if (typeof delta.role === 'string') role = delta.role;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof firstChoice.finish_reason === 'string') finishReason = firstChoice.finish_reason;

    if (Array.isArray(delta.tool_calls)) {
      appendChunkToolCalls(toolCalls, delta.tool_calls);
    }
  }

  const message: MindosOpenAICompatChoice['message'] = { role, content: content || null };
  if (toolCalls.size > 0) message.tool_calls = Array.from(toolCalls.values());

  return {
    choices: [{ message, finish_reason: finishReason }],
  };
}

export function parseMindosOpenAICompatResponse(rawText: string): MindosOpenAICompatCompletion | null {
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith('data:')) {
    return reassembleMindosOpenAISse(trimmed);
  }

  const parsed = parseUnknownJson(rawText);
  return normalizeMindosOpenAICompatCompletion(parsed);
}

export function mindosPiMessagesToOpenAI(piMessages: unknown[]): MindosOpenAIMessage[] {
  return piMessages
    .map((message) => {
      if (!isRecord(message)) return null;
      const role = message.role;

      if (role === 'system') return null;

      if (role === 'user') {
        return {
          role: 'user',
          content: typeof message.content === 'string' ? message.content : message.content,
        };
      }

      if (role === 'assistant') {
        const assistantContent = message.content;
        let textContent = '';
        const toolCalls: MindosOpenAIToolCall[] = [];

        if (Array.isArray(assistantContent)) {
          for (const rawPart of assistantContent) {
            if (!isRecord(rawPart)) continue;
            if (rawPart.type === 'text' && typeof rawPart.text === 'string') {
              textContent += rawPart.text;
            } else if (rawPart.type === 'toolCall') {
              toolCalls.push({
                id: typeof rawPart.id === 'string' ? rawPart.id : `call_${Date.now()}`,
                type: 'function',
                function: {
                  name: typeof rawPart.name === 'string' ? rawPart.name : 'unknown',
                  arguments: JSON.stringify(rawPart.arguments ?? {}),
                },
              });
            }
          }
        }

        const result: MindosOpenAIMessage = { role: 'assistant', content: textContent || '' };
        if (toolCalls.length > 0) result.tool_calls = toolCalls;
        return result;
      }

      if (role === 'toolResult') {
        const contentText = Array.isArray(message.content)
          ? message.content
              .filter((part): part is { type: string; text?: string } => isRecord(part) && part.type === 'text')
              .map((part) => part.text ?? '')
              .join('\n')
          : String(message.content ?? '');

        return {
          role: 'tool',
          tool_call_id: typeof message.toolCallId === 'string' ? message.toolCallId : 'unknown',
          content: contentText,
        };
      }

      return null;
    })
    .filter((message): message is MindosOpenAIMessage => message !== null);
}

export async function runMindosOpenAICompatFallback(options: MindosOpenAICompatFallbackOptions): Promise<void> {
  const {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    historyMessages,
    userContent,
    tools,
    send,
    signal,
    maxSteps,
  } = options;
  const fetchImpl = options.fetch ?? fetch;
  const chunkDelayMs = options.chunkDelayMs ?? 8;
  const requestStream = options.requestStream ?? false;

  const openaiTools = tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    },
  }));

  const messages: MindosOpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mindosPiMessagesToOpenAI(historyMessages),
    { role: 'user', content: userContent },
  ];

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const endpoints = buildMindosCompatEndpointCandidates(baseUrl, '/chat/completions', 'openai-completions');
  let step = 0;

  while (step < maxSteps) {
    if (signal.aborted) throw new Error('Request aborted');
    step += 1;

    const rawText = await fetchMindosOpenAICompatCompletion({
      endpoints,
      apiKey,
      model,
      messages,
      openaiTools,
      requestStream,
      signal,
      fetchImpl,
    });

    const data = parseMindosOpenAICompatResponse(rawText);
    if (!data) {
      throw new Error(`API returned invalid response: ${rawText.slice(0, 200)}`);
    }

    const choice = data.choices[0];
    if (!choice) throw new Error('Empty response from API');

    const message = choice.message;
    const contentText = getMindosOpenAIMessageText(message.content);
    if (contentText) {
      const chunkSize = 40;
      for (let i = 0; i < contentText.length; i += chunkSize) {
        send({ type: 'text_delta', delta: contentText.slice(i, i + chunkSize) });
        if (chunkDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, chunkDelayMs));
      }
    }

    const toolCalls = getMindosOpenAIToolCalls(message.tool_calls);
    if (choice.finish_reason === 'stop' || toolCalls.length === 0) break;

    const toolResultMessages: MindosOpenAIMessage[] = [];
    for (const [toolIndex, rawToolCall] of toolCalls.entries()) {
      const functionCall = isRecord(rawToolCall.function) ? rawToolCall.function : {};
      const toolName = typeof functionCall.name === 'string' ? functionCall.name : '';
      const toolCallId = typeof rawToolCall.id === 'string' ? rawToolCall.id : `call_${step}_${toolIndex}`;
      const parsedArgs = safeParseMindosJsonObject(
        typeof functionCall.arguments === 'string' ? functionCall.arguments : '{}',
      );

      const tool = toolMap.get(toolName);
      send({ type: 'tool_start', toolCallId, toolName, args: sanitizeToolArgs(toolName, parsedArgs) });

      let resultText = '';
      let isError = false;
      if (tool) {
        try {
          const result = await tool.execute(toolCallId, parsedArgs, signal, (update) => {
            const delta = getMindosToolUpdateText(update);
            if (delta) send({ type: 'tool_delta', toolCallId, toolName, delta: sanitizeToolOutput(delta) });
          });
          resultText = result.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text ?? '')
            .join('\n');
        } catch (error) {
          resultText = errorMessage(error);
          isError = true;
        }
      } else {
        resultText = `Tool "${toolName}" not found`;
        isError = true;
      }

      send({ type: 'tool_end', toolCallId, toolName, output: sanitizeToolOutput(resultText), isError });
      toolResultMessages.push({ role: 'tool', tool_call_id: toolCallId, content: resultText });
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });
    messages.push(...toolResultMessages);
  }
}

export async function runMindosNonStreamingFallback(options: MindosNonStreamingFallbackOptions): Promise<void> {
  await runMindosOpenAICompatFallback({
    ...options,
    requestStream: false,
  });
}

function appendChunkToolCalls(
  toolCalls: Map<number, MindosOpenAIToolCall>,
  rawToolCalls: unknown[],
): void {
  for (const rawToolCall of rawToolCalls) {
    if (!isRecord(rawToolCall)) continue;
    const toolCall = rawToolCall as MindosOpenAIChunkToolCall;
    const idx = typeof toolCall.index === 'number' ? toolCall.index : 0;
    const existing = toolCalls.get(idx);
    if (!existing) {
      toolCalls.set(idx, {
        id: toolCall.id ?? '',
        type: toolCall.type ?? 'function',
        function: {
          name: toolCall.function?.name ?? '',
          arguments: toolCall.function?.arguments ?? '',
        },
      });
    } else {
      if (toolCall.id) existing.id = toolCall.id;
      if (toolCall.function?.name) existing.function.name += toolCall.function.name;
      if (toolCall.function?.arguments) existing.function.arguments += toolCall.function.arguments;
    }
  }
}

function normalizeMindosOpenAICompatCompletion(value: unknown): MindosOpenAICompatCompletion | null {
  if (!isRecord(value)) return null;
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const normalizedChoices: MindosOpenAICompatChoice[] = [];

  for (const rawChoice of choices) {
    if (!isRecord(rawChoice)) continue;
    const rawMessage = isRecord(rawChoice.message)
      ? rawChoice.message
      : isRecord(rawChoice.delta)
        ? rawChoice.delta
        : undefined;
    if (!rawMessage) continue;
    normalizedChoices.push({
      message: {
        role: typeof rawMessage.role === 'string' ? rawMessage.role : 'assistant',
        content: rawMessage.content ?? null,
        ...(rawMessage.tool_calls !== undefined ? { tool_calls: rawMessage.tool_calls } : {}),
      },
      finish_reason: typeof rawChoice.finish_reason === 'string' ? rawChoice.finish_reason : 'stop',
    });
  }

  return { choices: normalizedChoices };
}

async function fetchMindosOpenAICompatCompletion(options: {
  endpoints: string[];
  apiKey: string;
  model: string;
  messages: MindosOpenAIMessage[];
  openaiTools: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
  requestStream: boolean;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<string> {
  let lastEndpointError = '';

  for (const endpoint of options.endpoints) {
    const attempt = await options.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        tools: options.openaiTools.length > 0 ? options.openaiTools : undefined,
        tool_choice: options.openaiTools.length > 0 ? 'auto' : undefined,
        stream: options.requestStream,
      }),
      signal: options.signal,
    });

    if (attempt.ok) {
      return attempt.text();
    }

    const errorText = await attempt.text().catch(() => '');
    lastEndpointError = `HTTP ${attempt.status} @ ${endpoint}: ${errorText.slice(0, 200)}`;
    if (attempt.status !== 404) {
      throw new Error(`OpenAI-compatible fallback API error ${lastEndpointError}`);
    }
  }

  throw new Error(`OpenAI-compatible fallback API error ${lastEndpointError || 'all endpoint candidates failed'}; tried ${options.endpoints.length} endpoint candidate(s)`);
}

function getMindosOpenAIMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isRecord(part)) return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'text' && typeof part.content === 'string') return part.content;
      return '';
    })
    .join('');
}

function getMindosOpenAIToolCalls(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getMindosToolUpdateText(update: unknown): string {
  if (!isRecord(update) || !Array.isArray(update.content)) return '';
  return update.content
    .filter(isRecord)
    .filter((part) => part.type === 'text' || part.type === undefined)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function parseUnknownJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
