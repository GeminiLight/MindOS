/**
 * TOML config editing for the CLI (Codex `~/.codex/config.toml`).
 *
 * Generated-bundle mirror: the implementation lives in
 * `src/agent/config/toml.ts` — the same line walker the product server uses —
 * and reaches the CLI through `bin/lib/generated/agent-config.mjs`
 * (see `agent-config.js`).
 */
import { loadAgentConfigBundle } from './agent-config.js';

export const {
  buildTomlEntry,
  listTomlServerNames,
  mergeTomlEntry,
  parseTomlMcpServerEntry,
  removeTomlEntry,
} = await loadAgentConfigBundle();
