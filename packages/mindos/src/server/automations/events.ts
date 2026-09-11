/**
 * Compat re-export: the studio-automation event inbox core lives in
 * `agent/automations/events.ts` (spec-knowledge-layering-and-export-surface —
 * the run ledger emits automation events, so the automation event/state core
 * sits in the agent layer; the server layer hosts workers, executors and HTTP
 * handlers on top). This path stays alive for the frozen automations tests
 * that import `./events.js`.
 */
export * from '../../agent/automations/events.js';
