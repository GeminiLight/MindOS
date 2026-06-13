/**
 * Process-global state registry for the agent core.
 *
 * One Node process can load more than one copy of these modules: the Next.js
 * server bundle inlines a copy while API helpers resolve the node_modules
 * copy, web shims re-export the core subpath, and a duplicated install can
 * physically ship two files. Module-level state would silently fork per copy
 * — a lock taken through one copy would be invisible to the other. Keying
 * the state through `Symbol.for` (the realm-wide symbol registry) makes
 * every copy share a single instance.
 *
 * All agent-domain `Symbol.for('mindos.*')` keys live in this file
 * (spec-agent-core-consolidation 关键设计决策). Every key documents why
 * cross-copy sharing is required; adding a key requires review.
 */

/** Resolve (or lazily create) the shared value for a registered key. */
export function getProcessGlobal<T>(key: symbol, create: () => T): T {
  const root = globalThis as typeof globalThis & Record<symbol, unknown>;
  if (root[key] === undefined) {
    root[key] = create();
  }
  return root[key] as T;
}

/** Drop the shared value so the next access re-creates it (test reloads). */
export function deleteProcessGlobal(key: symbol): void {
  const root = globalThis as typeof globalThis & Record<symbol, unknown>;
  delete root[key];
}

/**
 * File write lock map (file-write-lock.ts). Two agent runs writing the same
 * note must conflict even when their call paths import different module
 * copies; a forked lock map would let both writers proceed.
 */
export const AGENT_FILE_WRITE_LOCKS_KEY = Symbol.for('mindos.agentFileWriteLocks');

/**
 * In-memory run ledger store (run-ledger.ts). The ledger is hydrated from
 * disk once per process; a forked store would double-hydrate and the two
 * copies would diverge as runs progress (UI reads one, runtime writes the
 * other).
 */
export const AGENT_RUN_LEDGER_STORE_KEY = Symbol.for('mindos.agentRunLedger');

/**
 * Realtime ledger event subscribers (run-ledger.ts). SSE routes subscribe
 * through the web shim while runtimes emit through the core path — both must
 * land in one subscriber set or live updates silently stop.
 */
export const AGENT_RUN_LEDGER_SUBSCRIBERS_KEY = Symbol.for('mindos.agentRunLedger.subscribers');

/**
 * Per-process ledger shard identity (run-ledger.ts). Every module copy must
 * agree on the one `agent-run-ledger.<pid>-<startTs>.jsonl` file this
 * process owns; two copies computing their own start timestamp would write
 * two shards for one process and break the single-writer-per-shard
 * invariant.
 */
export const AGENT_RUN_LEDGER_SHARD_KEY = Symbol.for('mindos.agentRunLedger.shard');

/**
 * Run cancellation handler map (run-cancellation.ts). The cancel API route
 * resolves handlers registered by the streaming route; a forked map means
 * cancellation requests find no handler and runs become unkillable.
 */
export const AGENT_RUN_CANCEL_HANDLERS_KEY = Symbol.for('mindos.agentRunCancellation.handlers');

/**
 * Native runtime permission bridge state (runtime-permission-bridge.ts).
 * Pending permission requests are created inside the runtime stream and
 * resolved by a separate HTTP route; both sides must see one pending map.
 */
export const RUNTIME_PERMISSION_BRIDGE_KEY = Symbol.for('mindos.runtimePermissionBridge');

/**
 * AskUserQuestion bridge state (user-question-bridge.ts). Same shape as the
 * permission bridge: questions are raised mid-stream and answered via a
 * separate route.
 */
export const ASK_USER_QUESTION_BRIDGE_KEY = Symbol.for('mindos.askUserQuestionBridge');

/**
 * Request-scoped KB permission policy storage (kb-extension.ts). The pi
 * DefaultResourceLoader imports the host's kb-extension entry file in its own
 * module graph, so the AsyncLocalStorage written by the /api/ask route and
 * the one read during extension reload() only meet through this key. The key
 * string predates the consolidation — keep it stable.
 */
export const KB_PERMISSION_POLICY_STORAGE_KEY = Symbol.for('mindos.kbPermissionPolicyStorage');

/**
 * Module-level fallback KB policy (kb-extension.ts) used outside a scoped
 * runWithKbPermissionPolicy() call (setKbMode/setKbPermissionPolicy). Same
 * dual-module-graph problem as the storage above: a fallback set through the
 * web module copy must be visible to the loader-imported copy.
 */
export const KB_PERMISSION_POLICY_FALLBACK_KEY = Symbol.for('mindos.kbPermissionPolicyFallback');

/**
 * Host toolkit for the KB extension (kb-extension.ts). The pi loader imports
 * the host's kb-extension entry file with jiti, which resolves no host path
 * aliases (`@/...`), so the entry cannot import the host's tool registry or
 * audit log directly — any webpack-land import in its module graph makes the
 * whole entry fail to load and silently drops every KB tool. The host
 * registers its toolkit here (webpack module graph) and the entry reads it
 * back (jiti module graph).
 */
export const KB_EXTENSION_HOST_KEY = Symbol.for('mindos.kbExtensionHost');

/**
 * Buffered early subagent async completions (subagent-ledger-extension.ts).
 * A fast async subagent can emit its completion event before the tool
 * wrapper stores the asyncId on the ledger record; the payload is buffered
 * here until the wrapper registers the run. The event handler lives in the
 * pi loader's module graph while the wrapper may run through the host's copy
 * — both must share one buffer or early completions are lost. The key string
 * predates the consolidation — keep it stable.
 */
export const SUBAGENT_EARLY_ASYNC_COMPLETIONS_KEY = Symbol.for('mindos.subagentEarlyAsyncCompletions');

/**
 * Unsubscribe handle for the subagent async-complete event listener
 * (subagent-ledger-extension.ts). Extension reload() re-executes the entry
 * module — possibly a different copy than the one that subscribed — so the
 * previous listener can only be cleaned up through a shared slot. Replaces
 * the pre-consolidation `__mindosSubagentLedgerEventUnsubscribe` string key
 * on globalThis.
 */
export const SUBAGENT_LEDGER_EVENT_UNSUBSCRIBE_KEY = Symbol.for('mindos.subagentLedgerEventUnsubscribe');
