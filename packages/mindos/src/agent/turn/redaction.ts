/**
 * Compatibility path: the canonical secret redaction lives in
 * `agent/redaction.ts` (beside the run ledger that persists through it).
 * This module used to carry a verbatim copy; keep the import path alive for
 * server handlers and knowledge/audit callers, but with one implementation.
 */
export { redactSensitiveObject, redactSensitiveText } from '../redaction.js';
