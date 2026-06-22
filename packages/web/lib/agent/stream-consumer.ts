/**
 * Web adapter over the core stream consumer
 * (@geminilight/mindos/agent/stream/stream-consumer, Wave 4,
 * spec-agent-core-consolidation).
 *
 * The parsing/coalescing engine lives in the core package; this module wires
 * in the browser-only side effect — the coalesced `mindos:files-changed`
 * window event — and re-exports the consumer surface so existing imports
 * from '@/lib/agent/stream-consumer' keep working unchanged.
 */
import {
  consumeUIMessageStream as consumeUIMessageStreamCore,
  type ConsumeUIMessageStreamOptions,
} from '@geminilight/mindos/agent/stream/stream-consumer';
import type { Message } from '@/lib/types';
import { queueFilesChanged, flushFilesChanged } from './files-changed-emitter';

export type {
  AgentRunContextMetadata,
  ContextUsageMetadata,
  ConsumeUIMessageStreamOptions,
  FilesChangedSink,
  RuntimeBindingMetadata,
} from '@geminilight/mindos/agent/stream/stream-consumer';

export async function consumeUIMessageStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (message: Message) => void,
  signal?: AbortSignal,
  options: ConsumeUIMessageStreamOptions = {},
): Promise<Message> {
  return consumeUIMessageStreamCore(body, onUpdate, signal, {
    filesChanged: { queue: queueFilesChanged, flush: flushFilesChanged },
    ...options,
  });
}
