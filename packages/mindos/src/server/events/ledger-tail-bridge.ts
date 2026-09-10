import fs from 'node:fs';
import path from 'node:path';
import {
  agentLedgerMindRoot,
  agentLedgerOwnerIdentity,
  getAgentLedgerDatabase,
} from '../../agent/ledger/run-ledger.js';
import {
  readPendingPromptStoreVersion,
  subscribePendingPromptChanges,
} from '../../agent/bridges/pending-prompt-store.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { STUDIO_AUTOMATION_STATE_FILE } from '../automations/store.js';
import type { MindosServerEventBus } from './bus.js';

/**
 * Lazy cross-process tail of the shared agent-run ledger
 * (spec-cross-process-run-events A).
 *
 * `subscribeAgentRunEvents` (and therefore `ledger-bridge.ts`) only sees runs
 * written by THIS process. The automation worker, the standalone Product
 * Server and headless CLI turns write the same WAL sqlite file from their own
 * processes; without a tail, their runs never reach `GET /api/events` and the
 * clients fall back to polling. This bridge registers a lazy bus source that
 * polls the ledger — and the pending-prompt store's meta version plus the
 * automation state file fingerprint — once per second, but ONLY while at
 * least one SSE subscriber is connected.
 *
 * Rules:
 * - Rows owned by this process are skipped: `ledger-bridge` already emitted
 *   them the moment they were written (double emission would just cost an
 *   extra client refetch, but the ring would fill twice as fast).
 * - History is never replayed: the watermark is primed from `max(seq)` when
 *   the source starts (or when the ledger file identity changes on a mind
 *   root switch). A ledger file that does not exist at start primes to 0 —
 *   everything that appears later is genuinely new.
 * - `visibility = 'debug'` rows (token-rate deltas) are filtered in SQL.
 * - In-process pending-prompt changes bypass the tick through
 *   `subscribePendingPromptChanges`; the store's meta version covers changes
 *   made by OTHER processes, and the automation state file fingerprint
 *   covers automation approvals (which have no event source at all).
 */

export const LEDGER_TAIL_INTERVAL_MS = 1_000;
/** Bounded batch per tick; a bigger backlog simply continues on the next tick. */
const LEDGER_TAIL_BATCH_LIMIT = 500;

type TailBridgeState = {
  uninstall: () => void;
  /** True while the bus has subscribers and the tick loop is running. */
  running: boolean;
  /** Test observability: tick count and ledger read count since install. */
  ticks: number;
  ledgerReads: number;
};

type LedgerTailRow = {
  seq: number;
  id: string;
  run_id: string;
  root_run_id: string | null;
  parent_run_id: string | null;
  chat_session_id: string | null;
  ts: number;
  type: string;
  category: string;
  event_json: string;
  run_status: string | null;
  owner_pid: number | null;
  owner_start_ts: number | null;
};

const installed = new WeakMap<MindosServerEventBus, TailBridgeState>();

export function installLedgerTailBridge(
  bus: MindosServerEventBus,
  options: { intervalMs?: number } = {},
): () => void {
  const existing = installed.get(bus);
  if (existing) return existing.uninstall;
  const intervalMs = options.intervalMs ?? LEDGER_TAIL_INTERVAL_MS;
  const state: TailBridgeState = { uninstall: () => {}, running: false, ticks: 0, ledgerReads: 0 };

  // Per-source loop state; recreated on every subscriber reconnect.
  let timer: ReturnType<typeof setInterval> | null = null;
  let watermarkSeq: number | null = null;
  let lastDbFile: string | null = null;
  let lastPromptVersion: number | null = null;
  let lastAutomationFingerprint: string | null = null;

  function readMaxSeq(file: string): number {
    const db = getAgentLedgerDatabase({ create: false });
    if (!db || db.file !== file) return 0;
    state.ledgerReads += 1;
    try {
      const row = db.prepare('SELECT max(seq) AS max_seq FROM agent_run_events').get() as { max_seq: number | null } | undefined;
      return Number(row?.max_seq ?? 0);
    } catch {
      return 0;
    }
  }

  function automationFingerprint(): string | null {
    const mindRoot = agentLedgerMindRoot();
    if (!mindRoot) return null;
    try {
      const file = resolveExistingSafe(mindRoot, STUDIO_AUTOMATION_STATE_FILE);
      const stats = fs.statSync(file);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch {
      // A missing (or unreadable) state file is its own stable fingerprint.
      return null;
    }
  }

  function tailLedgerEvents(): void {
    const db = getAgentLedgerDatabase({ create: false });
    if (!db) return;
    state.ledgerReads += 1;
    if (db.file !== lastDbFile) {
      // Mind root switch or test reload: re-prime silently, never replay.
      // First-ever appearance of the file keeps the start-time watermark (0
      // when no ledger existed yet), so genuinely new runs are all emitted.
      if (lastDbFile !== null) watermarkSeq = readMaxSeq(db.file);
      lastDbFile = db.file;
    }
    if (watermarkSeq === null) watermarkSeq = readMaxSeq(db.file);
    let rows: LedgerTailRow[];
    try {
      rows = db.prepare(`
        SELECT e.seq AS seq, e.id AS id, e.run_id AS run_id, e.root_run_id AS root_run_id,
               e.chat_session_id AS chat_session_id, e.ts AS ts, e.type AS type, e.category AS category,
               e.event_json AS event_json, r.parent_run_id AS parent_run_id, r.status AS run_status,
               r.owner_pid AS owner_pid, r.owner_start_ts AS owner_start_ts
        FROM agent_run_events e LEFT JOIN agent_runs r ON r.id = e.run_id
        WHERE e.seq > ? AND e.visibility != 'debug'
        ORDER BY e.seq ASC LIMIT ?
      `).all(watermarkSeq, LEDGER_TAIL_BATCH_LIMIT) as unknown as LedgerTailRow[];
    } catch {
      // A torn read must not kill the loop; the next tick retries.
      return;
    }
    if (rows.length === 0) return;
    const self = agentLedgerOwnerIdentity();
    for (const row of rows) {
      watermarkSeq = Number(row.seq);
      if (
        row.owner_pid !== null
        && Number(row.owner_pid) === self.pid
        && Number(row.owner_start_ts) === self.startTs
      ) {
        continue; // written by this process; ledger-bridge already emitted it
      }
      try {
        let status = row.run_status ?? '';
        const parsed = JSON.parse(row.event_json) as { status?: unknown };
        if (typeof parsed.status === 'string' && parsed.status) status = parsed.status;
        bus.emit({
          type: 'agent-run.event',
          runId: row.run_id,
          ...(row.chat_session_id ? { chatSessionId: row.chat_session_id } : {}),
          event: {
            id: row.id,
            runId: row.run_id,
            ...(row.root_run_id && row.root_run_id !== row.run_id ? { rootRunId: row.root_run_id } : {}),
            ...(row.parent_run_id && row.parent_run_id !== row.run_id ? { parentRunId: row.parent_run_id } : {}),
            type: row.type,
            category: row.category,
            status,
            ts: Number(row.ts),
          },
        });
      } catch {
        // One corrupt row must not stop the batch; the watermark still moved.
      }
    }
  }

  function tailPendingPromptVersion(): void {
    const meta = readPendingPromptStoreVersion();
    const version = meta?.version ?? null;
    const previous = lastPromptVersion;
    lastPromptVersion = version;
    if (version === null || version === previous) return;
    if (previous === null && version === 0) return;
    const self = agentLedgerOwnerIdentity();
    if (meta && meta.writerPid === self.pid && meta.writerStartTs === self.startTs) {
      // Own writes already emitted through the in-process subscription below.
      return;
    }
    bus.emit({ type: 'run.pending-actions.changed' });
  }

  function tailAutomationState(): void {
    const fingerprint = automationFingerprint();
    const previous = lastAutomationFingerprint;
    lastAutomationFingerprint = fingerprint;
    if (fingerprint === previous) return;
    if (previous === null && fingerprint === null) return;
    bus.emit({ type: 'run.pending-actions.changed' });
  }

  function start(): () => void {
    state.running = true;
    // Prime every watermark synchronously so the first tick already knows
    // what "history" means (spec edge case: hundreds of rows at startup).
    const db = getAgentLedgerDatabase({ create: false });
    if (db) {
      state.ledgerReads += 1;
      lastDbFile = db.file;
      watermarkSeq = readMaxSeq(db.file);
    } else {
      lastDbFile = null;
      watermarkSeq = 0;
    }
    lastPromptVersion = readPendingPromptStoreVersion()?.version ?? null;
    lastAutomationFingerprint = automationFingerprint();

    const unsubscribePrompts = subscribePendingPromptChanges(() => {
      bus.emit({ type: 'run.pending-actions.changed' });
    });
    timer = setInterval(() => {
      state.ticks += 1;
      tailLedgerEvents();
      tailPendingPromptVersion();
      tailAutomationState();
    }, intervalMs);
    timer.unref?.();
    return () => {
      state.running = false;
      if (timer) clearInterval(timer);
      timer = null;
      unsubscribePrompts();
    };
  }

  const removeSource = bus.addSource(start);
  const uninstall = () => {
    if (installed.get(bus) !== state) return;
    installed.delete(bus);
    removeSource();
  };
  state.uninstall = uninstall;
  installed.set(bus, state);
  return uninstall;
}

/** True while the tail loop is running (bus installed AND at least one subscriber). */
export function isLedgerTailBridgeActive(bus: MindosServerEventBus): boolean {
  return installed.get(bus)?.running ?? false;
}

export function isLedgerTailBridgeInstalled(bus: MindosServerEventBus): boolean {
  return installed.has(bus);
}

/** Test-only observability into the lazy source (no polling without subscribers). */
export function getLedgerTailBridgeStatsForTest(bus: MindosServerEventBus): { ticks: number; ledgerReads: number } | null {
  const state = installed.get(bus);
  return state ? { ticks: state.ticks, ledgerReads: state.ledgerReads } : null;
}
