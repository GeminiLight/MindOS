/**
 * Compat re-export: the studio-automation state types live in
 * `agent/automations/types.ts` (spec-knowledge-layering-and-export-surface —
 * the run ledger emits automation events, so the automation event/state core
 * sits in the agent layer; the server layer hosts workers, executors and HTTP
 * handlers on top). This path stays alive for the frozen automations tests and
 * the two-process driver that resolve `server/automations/*`.
 */
export * from '../../agent/automations/types.js';
