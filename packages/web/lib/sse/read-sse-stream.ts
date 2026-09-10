/**
 * Shared SSE reader for the Web client.
 *
 * Follows the WHATWG event-stream grammar: lines are split on `\n` (one
 * trailing `\r` is stripped so CRLF works), `:`-prefixed lines are comments,
 * a line without a colon is a field with an empty value, exactly one leading
 * space is dropped from a field value (so `data:{}` and `data: {}` are the
 * same), `data` lines are joined with `\n`, and an empty line dispatches the
 * pending block only when it carried at least one `data` line.
 *
 * Lines whose field name is not event/data/id/retry are handed verbatim to
 * `onOtherLine`. This is how the legacy Vercel `0:"..."` lines reach the two
 * call sites that still accept them; the SSE frame itself is untouched.
 *
 * One documented deviation from the spec: `flush()` (run at EOF by
 * readSseStream and at the end of parseSseText) processes an unterminated
 * trailing line and dispatches a pending block that has data. The spec would
 * discard it, but every MindOS call site and the core client have always
 * consumed the trailing buffer, so a final frame without `\n\n` still counts.
 */

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface SseParserOptions {
  onFrame: (frame: SseFrame) => void;
  onOtherLine?: (line: string) => void;
}

export interface SseTextParser {
  push(text: string): void;
  flush(): void;
}

export function createSseTextParser(options: SseParserOptions): SseTextParser {
  let buffer = '';
  let eventName = '';
  let data = '';
  let hasData = false;
  let id: string | undefined;
  let retry: number | undefined;

  function reset(): void {
    eventName = '';
    data = '';
    hasData = false;
    id = undefined;
    retry = undefined;
  }

  function dispatch(): void {
    if (!hasData) {
      reset();
      return;
    }
    const frame: SseFrame = {
      event: eventName || 'message',
      data: data.endsWith('\n') ? data.slice(0, -1) : data,
    };
    if (id !== undefined) frame.id = id;
    if (retry !== undefined) frame.retry = retry;
    reset();
    options.onFrame(frame);
  }

  function processLine(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        eventName = value;
        break;
      case 'data':
        data += `${value}\n`;
        hasData = true;
        break;
      case 'id':
        if (!value.includes('\0')) id = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        options.onOtherLine?.(line);
    }
  }

  return {
    push(text: string): void {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    },
    flush(): void {
      if (buffer) {
        const tail = buffer;
        buffer = '';
        processLine(tail);
      }
      dispatch();
    },
  };
}

export function parseSseText(
  text: string,
  options: { onOtherLine?: (line: string) => void } = {},
): SseFrame[] {
  const frames: SseFrame[] = [];
  const parser = createSseTextParser({
    onFrame: (frame) => { frames.push(frame); },
    onOtherLine: options.onOtherLine,
  });
  parser.push(text);
  parser.flush();
  return frames;
}

type QueuedItem = { frame: SseFrame } | { line: string };

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void | Promise<void>,
  options: { signal?: AbortSignal; onOtherLine?: (line: string) => void } = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  // Frames and other lines are collected synchronously per chunk and then
  // delivered in arrival order, awaiting onFrame each time. A call site may
  // await inside onFrame (useAiOrganize captures a snapshot on tool_start) and
  // must still see later frames only after that work completes.
  let queue: QueuedItem[] = [];
  const parser = createSseTextParser({
    onFrame: (frame) => { queue.push({ frame }); },
    onOtherLine: options.onOtherLine ? (line) => { queue.push({ line }); } : undefined,
  });

  async function drain(): Promise<void> {
    const items = queue;
    queue = [];
    for (const item of items) {
      if ('frame' in item) await onFrame(item.frame);
      else options.onOtherLine?.(item.line);
    }
  }

  try {
    while (true) {
      if (options.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      await drain();
    }
    parser.push(decoder.decode());
    parser.flush();
    await drain();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a frame's data as a JSON object. Returns null for empty data, the
 * `[DONE]` sentinel, invalid JSON, or JSON that is not a plain object.
 */
export function parseSseJsonData<T extends object = Record<string, unknown>>(frame: SseFrame): T | null {
  const data = frame.data.trim();
  if (!data || data === '[DONE]') return null;
  try {
    const value: unknown = JSON.parse(data);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  } catch {
    // Non-JSON data is a valid SSE payload; callers decide what to do with null.
  }
  return null;
}
