export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import {
  getMindosServerEventBus,
  handleEventsStream,
  installAgentRunLedgerBridge,
  installLedgerTailBridge,
  installRuntimeControlPlaneBridge,
  type MindosServerEventBus,
} from '@geminilight/mindos/server';
import { getTreeVersion } from '@/lib/fs';
import { registerTreeVersionHook } from '@/lib/server-events-bridge';
import { toNextResponse } from '../_mindos-adapter';

const TREE_VERSION_HOOK_KEY = 'app/api/events';
const encoder = new TextEncoder();

/**
 * Wire the host's event sources into the process bus. Idempotent: the ledger
 * bridge is keyed per bus and the tree-version hook per name, so HMR reloads
 * and concurrent requests never double-register.
 */
function prepareBus(): MindosServerEventBus {
  const bus = getMindosServerEventBus();
  installAgentRunLedgerBridge(bus);
  installLedgerTailBridge(bus);
  installRuntimeControlPlaneBridge(bus);
  registerTreeVersionHook(TREE_VERSION_HOOK_KEY, (version) => {
    bus.emit({ type: 'tree.changed', version });
  });
  return bus;
}

function toReadableStream(frames: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const iterator = frames[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      // Client went away: run the generator's finally block (unsubscribe, stop heartbeat).
      await iterator.return?.();
    },
  });
}

export async function GET(req: Request) {
  const bus = prepareBus();
  const url = new URL(req.url);
  const response = handleEventsStream(url.searchParams, {
    events: bus,
    getTreeVersion: () => getTreeVersion(),
  }, {
    signal: req.signal,
    lastEventId: req.headers.get('last-event-id'),
  });
  if (!response.ok) return toNextResponse(response);

  return new Response(toReadableStream(response.body), {
    status: response.status,
    headers: response.headers,
  });
}
