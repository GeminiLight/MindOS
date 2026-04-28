import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MindOSSSEvent } from '@/lib/sse/events';
import { buildCompatEndpointCandidates } from './providers';

/**
 * Reassemble SSE chunks (from proxies that ignore stream:false) into a
 * single OpenAI-style chat completion response.
 *
 * SSE format:  data: {"choices":[{"delta":{"content":"He"}}]}
 * Output:      {"choices":[{"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}]}
 */
export function reassembleSSE(sseText: string): any {
  const lines = sseText.split('\n');
  let content = '';
  let role = 'assistant';
  let finishReason = 'stop';
  const toolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.role) role = delta.role;
    if (delta.content) content += delta.content;
    if (chunk.choices[0].finish_reason) finishReason = chunk.choices[0].finish_reason;

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCalls.get(idx);
        if (!existing) {
          toolCalls.set(idx, {
            id: tc.id ?? '',
            type: tc.type ?? 'function',
            function: {
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            },
          });
        } else {
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const message: any = { role, content: content || null };
  if (toolCalls.size > 0) {
    message.tool_calls = Array.from(toolCalls.values());
  }

  return {
    choices: [{ message, finish_reason: finishReason }],
  };
}

/**
 * Convert pi-ai format messages to OpenAI API format.
 * pi-ai messages have nested structures; OpenAI format is flatter with tool_calls array.
 */
export function piMessagesToOpenAI(piMessages: any[]): any[] {
  return piMessages.map(msg => {
    const role = msg.role;

    if (role === 'system') return null;

    if (role === 'user') {
      return {
        role: 'user',
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      };
    }

    if (role === 'assistant') {
      const content = msg.content;
      let textContent = '';
      const toolCalls: any[] = [];

      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            textContent += part.text;
          } else if (part.type === 'toolCall') {
            toolCalls.push({
              id: part.id ?? `call_${Date.now()}`,
              type: 'function',
              function: {
                name: part.name ?? 'unknown',
                arguments: JSON.stringify(part.arguments ?? {}),
              },
            });
          }
        }
      }

      const result: any = { role: 'assistant' };
      result.content = textContent || '';
      if (toolCalls.length > 0) result.tool_calls = toolCalls;
      return result;
    }

    if (role === 'toolResult') {
      const contentText = Array.isArray(msg.content)
        ? msg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text ?? '')
            .join('\n')
        : String(msg.content ?? '');

      return {
        role: 'tool',
        tool_call_id: msg.toolCallId ?? 'unknown',
        content: contentText,
      };
    }

    return null;
  }).filter(Boolean);
}

/**
 * Options for the non-streaming fallback agent loop.
 */
export interface NonStreamingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  historyMessages: any[];
  userContent: string;
  tools: AgentTool<any>[];
  send: (event: MindOSSSEvent) => void;
  signal: AbortSignal;
  maxSteps: number;
}

/**
 * Mini agent loop using non-streaming OpenAI-compatible API.
 * Used when a proxy silently breaks stream+tools by returning plain text.
 * Emits SSE events identical to the streaming path so the frontend is unaffected.
 */
export async function runNonStreamingFallback(opts: NonStreamingOptions): Promise<void> {
  const { baseUrl, apiKey, model, systemPrompt, historyMessages, userContent, tools, send, signal, maxSteps } = opts;

  const openaiTools = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t as any).parameters ?? { type: 'object', properties: {} },
    },
  }));

  const openaiMessages = piMessagesToOpenAI(historyMessages);

  const messages: { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }[] = [
    { role: 'system', content: systemPrompt },
    ...openaiMessages,
    { role: 'user', content: userContent },
  ];

  const toolMap = new Map(tools.map(t => [t.name, t]));
  const endpoints = buildCompatEndpointCandidates(baseUrl, '/chat/completions', 'openai-completions');
  let step = 0;

  while (step < maxSteps) {
    if (signal.aborted) throw new Error('Request aborted');
    step++;

    let resp: Response | null = null;
    let lastEndpointError = '';

    for (const endpoint of endpoints) {
      const attempt = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
          stream: true,
        }),
        signal,
      });

      if (attempt.ok) {
        resp = attempt;
        break;
      }

      const errText = await attempt.text().catch(() => '');
      lastEndpointError = `HTTP ${attempt.status} @ ${endpoint}: ${errText.slice(0, 200)}`;
      if (attempt.status !== 404) {
        throw new Error(`Non-streaming API error ${lastEndpointError}`);
      }
    }

    if (!resp) {
      throw new Error(`Non-streaming API error ${lastEndpointError || 'all endpoint candidates failed'}; tried ${endpoints.length} endpoint candidate(s)`);
    }

    const rawText = await resp.text();
    const trimmed = rawText.trimStart();

    let data: any;
    if (trimmed.startsWith('data:')) {
      data = reassembleSSE(trimmed);
    } else {
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`API returned invalid response: ${rawText.slice(0, 200)}`);
      }
    }

    const choice = data?.choices?.[0];
    if (!choice) throw new Error('Empty response from API');

    const msg = choice.message ?? choice.delta ?? {};
    const finishReason: string = choice.finish_reason ?? 'stop';

    if (msg.content) {
      const text: string = typeof msg.content === 'string' ? msg.content : '';
      if (text) {
        const chunkSize = 40;
        for (let i = 0; i < text.length; i += chunkSize) {
          send({ type: 'text_delta', delta: text.slice(i, i + chunkSize) });
          await new Promise(r => setTimeout(r, 8));
        }
      }
    }

    if (finishReason === 'stop' || !msg.tool_calls?.length) break;

    const toolResultMessages: { role: string; tool_call_id: string; content: string }[] = [];
    for (const tc of msg.tool_calls) {
      const toolName = tc.function?.name ?? '';
      const toolCallId = tc.id ?? `call_${Date.now()}`;
      let parsedArgs: Record<string, unknown> = {};
      try { parsedArgs = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /* ignore */ }

      const tool = toolMap.get(toolName);
      send({ type: 'tool_start', toolCallId, toolName, args: parsedArgs });

      let resultText = '';
      let isError = false;
      if (tool) {
        try {
          const result = await tool.execute(toolCallId, parsedArgs, signal);
          resultText = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        } catch (err) {
          resultText = err instanceof Error ? err.message : String(err);
          isError = true;
        }
      } else {
        resultText = `Tool "${toolName}" not found`;
        isError = true;
      }

      send({ type: 'tool_end', toolCallId, output: resultText, isError });
      toolResultMessages.push({ role: 'tool', tool_call_id: toolCallId, content: resultText });
    }

    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    messages.push(...toolResultMessages);
  }
}
