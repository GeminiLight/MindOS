/**
 * knowledge → agent run-data ports (spec-knowledge-layering-and-export-surface).
 *
 * `knowledge/method-checks`, `knowledge/inquiries`, `knowledge/transfer` and
 * `knowledge/context-feedback` read agent run history and run capsules. The
 * ledger and capsule stores live in the agent layer, above knowledge, so these
 * modules used to import upward (`knowledge → agent`). Instead, knowledge
 * declares the minimal read contracts it needs and the agent modules install
 * the real implementations at module load:
 *
 * - `agent/ledger/run-ledger.ts` installs `listAgentRuns`;
 * - `agent/capsules/store.ts` installs `getAgentRunCapsule`;
 * - the `src/knowledge.ts` barrel side-effect-imports both so barrel-only
 *   consumers (web echo routes, CLI) stay wired exactly like the old static
 *   import graph did.
 *
 * The registry is process-global (`Symbol.for`, the same reasoning as
 * `agent/global-state.ts` and `server/events/bus.ts`) so every module copy in
 * a multi-bundle Next.js host shares one installation. Unwired reads throw a
 * descriptive error instead of silently returning empty data.
 */

export type KnowledgeAgentRunStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out';

/** The subset of the agent run ledger record that knowledge modules consume. */
export interface KnowledgeAgentRunSnapshot {
  id: string;
  runtimeId: string;
  status: KnowledgeAgentRunStatus;
  startedAt: number;
  completedAt?: number;
  outputSummary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** The subset of an agent run capsule that knowledge modules consume. */
export interface KnowledgeAgentRunCapsuleView {
  id: string;
  runId: string;
  chatSessionId?: string;
  request: {
    messages: Array<Record<string, unknown>>;
    runtime: { name: string };
  };
  result?: { outputText?: string };
}

export type KnowledgeAgentRunLister = (
  options?: { limit?: number },
) => readonly KnowledgeAgentRunSnapshot[];

export type KnowledgeAgentRunCapsuleReader = (
  mindRoot: string,
  id: string,
) => KnowledgeAgentRunCapsuleView | null;

const AGENT_RUN_DATA_KEY = Symbol.for('mindos.knowledgeAgentRunData');

type AgentRunDataRegistry = {
  listRuns?: KnowledgeAgentRunLister;
  readCapsule?: KnowledgeAgentRunCapsuleReader;
};

function agentRunDataRegistry(): AgentRunDataRegistry {
  const globals = globalThis as unknown as Record<symbol, AgentRunDataRegistry | undefined>;
  let entry = globals[AGENT_RUN_DATA_KEY];
  if (!entry) {
    entry = {};
    globals[AGENT_RUN_DATA_KEY] = entry;
  }
  return entry;
}

export function installKnowledgeAgentRunLister(lister: KnowledgeAgentRunLister | null): void {
  const registry = agentRunDataRegistry();
  if (lister) registry.listRuns = lister;
  else delete registry.listRuns;
}

export function installKnowledgeAgentRunCapsuleReader(reader: KnowledgeAgentRunCapsuleReader | null): void {
  const registry = agentRunDataRegistry();
  if (reader) registry.readCapsule = reader;
  else delete registry.readCapsule;
}

function unwiredError(what: string, wiringModule: string): Error {
  return new Error(
    `Knowledge ${what} is not wired in this process. Load the @geminilight/mindos/knowledge barrel (it installs the agent data sources) or import ${wiringModule} before calling it.`,
  );
}

export function listKnowledgeAgentRuns(
  options?: { limit?: number },
): readonly KnowledgeAgentRunSnapshot[] {
  const lister = agentRunDataRegistry().listRuns;
  if (!lister) throw unwiredError('agent run listing', 'agent/ledger/run-ledger.js');
  return lister(options);
}

export function getKnowledgeAgentRunCapsule(
  mindRoot: string,
  id: string,
): KnowledgeAgentRunCapsuleView | null {
  const reader = agentRunDataRegistry().readCapsule;
  if (!reader) throw unwiredError('agent run capsule access', 'agent/capsules/store.js');
  return reader(mindRoot, id);
}
