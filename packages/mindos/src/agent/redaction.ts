/**
 * Compatibility path: the canonical secret redaction lives in
 * `foundation/security/redaction.ts`. This module used to carry the
 * implementation; keep the import path alive for existing agent-side callers
 * and the `@geminilight/mindos/agent/redaction` web deep import, but with one
 * implementation (spec-runtime-lane-contract).
 */
export { redactSensitiveObject, redactSensitiveText } from '../foundation/security/redaction.js';
