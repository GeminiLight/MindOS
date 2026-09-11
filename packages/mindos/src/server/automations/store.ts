/**
 * Compat re-export: the studio-automation state store lives in
 * `agent/automations/store.ts` (spec-knowledge-layering-and-export-surface —
 * the run ledger emits automation events, so the automation event/state core
 * sits in the agent layer; the server layer hosts workers, executors and HTTP
 * handlers on top). This path stays alive for the frozen automations/ledger
 * tests and `store-two-process-driver.mjs`, which import
 * `dist/server/automations/store.js`.
 */
export * from '../../agent/automations/store.js';
