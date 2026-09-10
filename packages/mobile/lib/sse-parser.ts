/**
 * Server-Sent Events wire parser for React Native.
 *
 * Hermes has no `EventSource`, so the shared `/api/events` consumer reads the
 * response body through `expo/fetch` streaming and feeds the raw bytes here.
 * The parser follows the WHATWG event-stream grammar: chunks may end in the
 * middle of a line or of a multi-byte UTF-8 character, line terminators may be
 * CRLF / LF / CR (with the CR and LF split across chunks), `data:` lines are
 * joined with `\n`, comment lines are ignored, and a block only dispatches
 * when its data buffer is non-empty. `lastEventId` persists across events.
 *
 * Two end-of-stream behaviours are offered because the two consumers differ:
 * `end()` follows the spec and discards an unterminated block (used by the
 * long-lived `/api/events` stream), while `flush()` dispatches it (used by the
 * agent-turn client, whose final `done` frame may arrive without a trailing
 * blank line).
 *
 * Nothing in this file touches React Native APIs so it is unit-testable in Node.
 */

export interface SseFrame {
  /** `event:` field, or `message` when the block did not set one. */
  event: string;
  /** All `data:` lines joined with `\n` (trailing newline removed). */
  data: string;
  /** The most recent `id:` seen on the stream, possibly set by an earlier block. */
  lastEventId: string;
  /** `retry:` field when the block carried a numeric one. */
  retryMs?: number;
}

export interface SseParser {
  push(chunk: Uint8Array | string): void;
  /** End of stream: per spec an unterminated event is discarded, never dispatched. */
  end(): void;
  /**
   * End of stream, lenient variant: treat an unterminated trailing line as
   * complete, then dispatch the current block if it has data (exactly as a
   * blank line would). Afterwards the parser is empty and can keep accepting
   * chunks.
   */
  flush(): void;
}

export interface Utf8StreamDecoder {
  /**
   * Decode `chunk`. With `stream: true` an incomplete trailing sequence is held
   * back for the next call; with `stream: false` it is flushed as U+FFFD.
   */
  decode(chunk: Uint8Array, stream: boolean): string;
}

const REPLACEMENT = '�';

type TextDecoderLike = { decode(input?: Uint8Array, options?: { stream?: boolean }): string };
type TextDecoderCtor = new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }) => TextDecoderLike;

function nativeTextDecoder(): TextDecoderLike | null {
  const ctor = (globalThis as { TextDecoder?: unknown }).TextDecoder;
  if (typeof ctor !== 'function') return null;
  try {
    // ignoreBOM keeps the BOM in the output so the parser strips it uniformly.
    return new (ctor as TextDecoderCtor)('utf-8', { fatal: false, ignoreBOM: true });
  } catch {
    return null;
  }
}

/** Expected sequence length for a UTF-8 lead byte, or 0 when it cannot start a sequence. */
function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

function decodeUtf8Sequence(bytes: Uint8Array, start: number, length: number): string {
  const lead = bytes[start];
  let codePoint = length === 2 ? lead & 0x1f : length === 3 ? lead & 0x0f : lead & 0x07;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[start + i];
    if ((byte & 0xc0) !== 0x80) return REPLACEMENT;
    codePoint = (codePoint << 6) | (byte & 0x3f);
  }
  // Reject overlong encodings, surrogates and out-of-range values.
  if (length === 3 && (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff))) return REPLACEMENT;
  if (length === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff)) return REPLACEMENT;
  return String.fromCodePoint(codePoint);
}

function createBuiltInUtf8Decoder(): Utf8StreamDecoder {
  let pending: Uint8Array = new Uint8Array(0);
  return {
    decode(chunk, stream) {
      let bytes: Uint8Array;
      if (pending.length === 0) {
        bytes = chunk;
      } else {
        bytes = new Uint8Array(pending.length + chunk.length);
        bytes.set(pending, 0);
        bytes.set(chunk, pending.length);
        pending = new Uint8Array(0);
      }

      let out = '';
      let i = 0;
      while (i < bytes.length) {
        const lead = bytes[i];
        const length = utf8SequenceLength(lead);
        if (length === 0) {
          out += REPLACEMENT;
          i += 1;
          continue;
        }
        if (length === 1) {
          out += String.fromCharCode(lead);
          i += 1;
          continue;
        }
        if (i + length > bytes.length) {
          if (stream) {
            pending = bytes.slice(i);
          } else {
            out += REPLACEMENT;
          }
          break;
        }
        out += decodeUtf8Sequence(bytes, i, length);
        i += length;
      }
      return out;
    },
  };
}

export function createUtf8StreamDecoder(options: { useTextDecoder?: boolean } = {}): Utf8StreamDecoder {
  const preferNative = options.useTextDecoder ?? true;
  const native = preferNative ? nativeTextDecoder() : null;
  if (!native) return createBuiltInUtf8Decoder();
  return {
    decode(chunk, stream) {
      return native.decode(chunk, { stream });
    },
  };
}

export function createSseParser(onFrame: (frame: SseFrame) => void): SseParser {
  const decoder = createUtf8StreamDecoder();
  let textBuffer = '';
  let pendingCR = false;
  let strippedBom = false;

  let dataBuffer = '';
  let hasData = false;
  let eventName = '';
  let lastEventId = '';
  let retryMs: number | undefined;

  function resetBlock(): void {
    dataBuffer = '';
    hasData = false;
    eventName = '';
    retryMs = undefined;
  }

  function dispatch(): void {
    if (!hasData) {
      resetBlock();
      return;
    }
    const data = dataBuffer.endsWith('\n') ? dataBuffer.slice(0, -1) : dataBuffer;
    const frame: SseFrame = {
      event: eventName || 'message',
      data,
      lastEventId,
      ...(retryMs !== undefined ? { retryMs } : {}),
    };
    resetBlock();
    onFrame(frame);
  }

  function processField(field: string, value: string): void {
    switch (field) {
      case 'event':
        eventName = value;
        break;
      case 'data':
        dataBuffer += `${value}\n`;
        hasData = true;
        break;
      case 'id':
        if (!value.includes('\u0000')) lastEventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) retryMs = Number(value);
        break;
      default:
        // Unknown fields are ignored per spec.
        break;
    }
  }

  function processLine(line: string): void {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    if (colon === -1) {
      processField(line, '');
      return;
    }
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    processField(field, value);
  }

  function consumeText(text: string): void {
    if (text.length === 0) return;
    if (!strippedBom) {
      strippedBom = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (pendingCR) {
      pendingCR = false;
      if (text.startsWith('\n')) text = text.slice(1);
    }
    textBuffer += text;

    let start = 0;
    for (let i = 0; i < textBuffer.length; i += 1) {
      const code = textBuffer.charCodeAt(i);
      if (code === 10) {
        processLine(textBuffer.slice(start, i));
        start = i + 1;
      } else if (code === 13) {
        processLine(textBuffer.slice(start, i));
        if (i + 1 < textBuffer.length) {
          if (textBuffer.charCodeAt(i + 1) === 10) i += 1;
        } else {
          pendingCR = true;
        }
        start = i + 1;
      }
    }
    textBuffer = textBuffer.slice(start);
  }

  return {
    push(chunk) {
      if (typeof chunk === 'string') {
        consumeText(chunk);
        return;
      }
      if (chunk.length === 0) return;
      consumeText(decoder.decode(chunk, true));
    },
    end() {
      textBuffer = '';
      pendingCR = false;
      resetBlock();
    },
    flush() {
      // textBuffer never holds a terminator, so whatever is left is one
      // partial line; a pending CR has already terminated its line.
      if (textBuffer.length > 0) {
        const line = textBuffer;
        textBuffer = '';
        processLine(line);
      }
      pendingCR = false;
      dispatch();
    },
  };
}
