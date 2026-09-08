import { subscribeAgentRunEvents } from '../../agent/ledger/run-ledger.js';
import type { AgentEvent } from '../../agent/ledger/run-ledger-types.js';
import type { MindosAgentRunEventSummary, MindosServerEventBus } from './bus.js';

/**
 * Forwards agent run ledger events onto the server event bus as
 * `agent-run.event`. Lives in the server layer so the ledger stays unaware of
 * transport concerns.
 *
 * Only timeline-visibility events are forwarded: `visibility: 'debug'` deltas
 * arrive at token rate and would both flood the replay ring (evicting tree /
 * skills / sync events) and push every streamed token to every connected tab.
 * The forwarded body is a compact summary; the client only needs a trigger
 * and fetches the full timeline through `/api/agent-runs`.
 */

const installed = new WeakMap<MindosServerEventBus, () => void>();

export function summarizeAgentRunEvent(event: AgentEvent): MindosAgentRunEventSummary {
  const record = event.record;
  return {
    id: event.id,
    runId: event.runId,
    ...(record?.rootRunId && record.rootRunId !== event.runId ? { rootRunId: record.rootRunId } : {}),
    ...(record?.parentRunId && record.parentRunId !== event.runId ? { parentRunId: record.parentRunId } : {}),
    type: event.type,
    category: event.category,
    status: event.status,
    ts: event.ts,
  };
}

export function installAgentRunLedgerBridge(bus: MindosServerEventBus): () => void {
  const existing = installed.get(bus);
  if (existing) return existing;

  const unsubscribe = subscribeAgentRunEvents((event) => {
    if (event.visibility === 'debug') return;
    const chatSessionId = event.record?.chatSessionId;
    bus.emit({
      type: 'agent-run.event',
      runId: event.runId,
      ...(chatSessionId ? { chatSessionId } : {}),
      event: summarizeAgentRunEvent(event),
    });
  });

  const uninstall = () => {
    if (installed.get(bus) !== uninstall) return;
    installed.delete(bus);
    unsubscribe();
  };
  installed.set(bus, uninstall);
  return uninstall;
}

export function isAgentRunLedgerBridgeInstalled(bus: MindosServerEventBus): boolean {
  return installed.has(bus);
}
