/**
 * Compatibility path: the canonical secret redaction lives in
 * `foundation/security/redaction.ts`; `agent/redaction.ts` is itself a
 * re-export. Keep the import path alive for server handlers and
 * knowledge/audit callers, but with one implementation
 * (spec-runtime-lane-contract).
 */
export { redactSensitiveObject, redactSensitiveText } from '../../foundation/security/redaction.js';
