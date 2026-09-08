import { CORS_HEADERS, type MindosServerResponse } from './response.js';
import {
  encodeMindosSseEvent,
  startMindosAgentTurnSseHeartbeat,
  type MindOSSSEvent,
} from '../agent/turn/index.js';

export type ToWebResponseOptions = {
  /** Used for `If-None-Match` revalidation and, for SSE, client-disconnect detection. */
  request?: Request;
  /** Runs once an SSE body has been fully written or abandoned (used for tree-cache invalidation). */
  onStreamFinish?: () => void;
};

const SSE_FRAMES = Symbol.for('mindos.server.sse-frames');

/** Pre-encoded SSE frames (already `event:/id:/data:` text) that own their heartbeat, e.g. `GET /api/events`. */
export type SseFrameBody = { readonly [SSE_FRAMES]: true; readonly frames: AsyncIterable<string> };

/** Marks a frame iterator so `toWebResponse` streams it verbatim instead of encoding MindOS SSE events. */
export function sseFrames(frames: AsyncIterable<string>): SseFrameBody {
  return { [SSE_FRAMES]: true, frames };
}

export function isSseFrameBody(body: unknown): body is SseFrameBody {
  return Boolean(body) && typeof body === 'object' && (body as Record<PropertyKey, unknown>)[SSE_FRAMES] === true;
}

/** An async iterable of `MindOSSSEvent`s (agent turns); encoded with the MindOS heartbeat and error frame. */
export function isSseBody(body: unknown): body is AsyncIterable<MindOSSSEvent> {
  return Boolean(body)
    && typeof body === 'object'
    && !(body instanceof Uint8Array)
    && Symbol.asyncIterator in (body as object);
}

export function etagMatches(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === '*') return true;
  const strip = (value: string) => value.trim().replace(/^W\//, '');
  const wanted = strip(etag);
  return ifNoneMatch.split(',').some((candidate) => strip(candidate) === wanted);
}

/**
 * Converts a handler result into a Web-standard `Response`: CORS headers,
 * JSON by default (binary bodies keep their own content type), `304` for a
 * matching `If-None-Match` on a 200 with an ETag, and an SSE stream when the
 * body is an async iterable of MindOS SSE events or a `sseFrames(...)` body.
 */
export function toWebResponse<T>(response: MindosServerResponse<T>, options: ToWebResponseOptions = {}): Response {
  const body = response.body;
  const isBinary = body instanceof Uint8Array;
  const isFrames = isSseFrameBody(body);
  const isStream = isFrames || isSseBody(body);

  // Sequential `set` keeps the legacy `writeHead` semantics: later keys win
  // regardless of casing, instead of `Headers` joining duplicates with commas.
  const headers = new Headers();
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  if (!isBinary && !isStream) headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(response.headers ?? {})) headers.set(key, value);

  if (isFrames) {
    // The frame source runs its own heartbeat and never surfaces errors as frames.
    return createSseResponse(body.frames, response.status, headers, options, {
      encode: (frame) => frame,
      heartbeat: false,
    });
  }
  if (isSseBody(body)) {
    return createSseResponse(body, response.status, headers, options, {
      encode: encodeMindosSseEvent,
      heartbeat: true,
      encodeError: (message) => encodeMindosSseEvent({ type: 'error', message }),
    });
  }

  const etag = headers.get('etag');
  const ifNoneMatch = options.request?.headers.get('if-none-match');
  if (etag && response.status === 200 && ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
    headers.delete('content-type');
    return new Response(null, { status: 304, headers });
  }

  if (response.status === 204 || body === undefined) {
    return new Response(null, { status: response.status, headers });
  }
  if (isBinary) {
    return new Response(body as BodyInit, { status: response.status, headers });
  }
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

type SseCodec<T> = {
  encode: (item: T) => string;
  /** Emit the MindOS keep-alive status event; off for sources that heartbeat themselves. */
  heartbeat: boolean;
  /** Turns a mid-stream throw into a terminal frame; omitted sources just end the stream. */
  encodeError?: (message: string) => string;
};

/**
 * SSE body as a `ReadableStream`. Behaviour carried over from the Node writer:
 * an optional keep-alive heartbeat that stops itself once writes fail, a client
 * disconnect (stream cancel or request abort) that stops pulling the generator
 * on its next item so its `finally` blocks run, and a mid-stream throw that
 * becomes a terminal `error` frame (when the codec has one) followed by a clean
 * close, so the server keeps serving.
 */
function createSseResponse<T>(
  iterable: AsyncIterable<T>,
  status: number,
  headers: Headers,
  options: ToWebResponseOptions,
  codec: SseCodec<T>,
): Response {
  const encoder = new TextEncoder();
  const signal = options.request?.signal;
  let closed = false;
  let stopHeartbeat: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeText = (text: string) => {
        if (closed) throw new Error('SSE response is closed');
        controller.enqueue(encoder.encode(text));
      };
      const markClosed = () => {
        closed = true;
      };
      if (codec.heartbeat) {
        stopHeartbeat = startMindosAgentTurnSseHeartbeat((event) => writeText(encodeMindosSseEvent(event)));
      }
      signal?.addEventListener('abort', markClosed, { once: true });

      void (async () => {
        try {
          for await (const item of iterable) {
            if (closed || signal?.aborted) break;
            writeText(codec.encode(item));
          }
        } catch (error) {
          if (codec.encodeError && !closed) {
            const message = error instanceof Error ? error.message : String(error);
            try {
              writeText(codec.encodeError(message));
            } catch {
              // The consumer vanished between the check and the write.
            }
          }
        } finally {
          stopHeartbeat();
          signal?.removeEventListener('abort', markClosed);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // Already closed by the consumer.
            }
          }
          options.onStreamFinish?.();
        }
      })();
    },
    cancel() {
      closed = true;
      stopHeartbeat();
    },
  });

  return new Response(stream, { status, headers });
}
