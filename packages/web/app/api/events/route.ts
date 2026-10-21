export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  getMindosServerEventBus,
  handleEventsStream,
  installAgentRunLedgerBridge,
  installLedgerTailBridge,
  installRuntimeControlPlaneBridge,
  type MindosServerEventBus,
} from "@geminilight/mindos/server";
import { watchViews } from "@geminilight/mindos/knowledge/views";
import { getMindRoot, getTreeVersion } from "@/lib/fs";
import { registerTreeVersionHook } from "@/lib/server-events-bridge";
import { toNextResponse } from "../_mindos-adapter";

const TREE_VERSION_HOOK_KEY = "app/api/events";
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
    bus.emit({ type: "tree.changed", version });
  });
  return bus;
}

function toReadableStream(
  frames: AsyncIterable<string>,
  onClose: () => void,
): ReadableStream<Uint8Array> {
  const iterator = frames[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          onClose();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (error) {
        onClose();
        controller.error(error);
      }
    },
    async cancel() {
      // Client went away: run the generator's finally block (unsubscribe, stop heartbeat).
      await iterator.return?.();
      onClose();
    },
  });
}

export async function GET(req: Request) {
  const bus = prepareBus();
  const url = new URL(req.url);
  const stopViews = watchViews(getMindRoot(), (event) => bus.emit(event));
  req.signal.addEventListener("abort", stopViews, { once: true });
  const response = handleEventsStream(
    url.searchParams,
    {
      events: bus,
      getTreeVersion: () => getTreeVersion(),
    },
    {
      signal: req.signal,
      lastEventId: req.headers.get("last-event-id"),
    },
  );
  if (!response.ok) {
    stopViews();
    return toNextResponse(response);
  }

  return new Response(toReadableStream(response.body, stopViews), {
    status: response.status,
    headers: response.headers,
  });
}
