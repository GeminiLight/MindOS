/**
 * YAML config editing for the CLI (Hermes `~/.hermes/config.yaml`).
 *
 * Generated-bundle mirror: the implementation lives in
 * `src/agent/config/yaml.ts` — the same line walker the product server uses —
 * and reaches the CLI through `bin/lib/generated/agent-config.mjs`
 * (see `agent-config.js`).
 */
import { loadAgentConfigBundle } from './agent-config.js';

export const {
  buildYamlEntry,
  listYamlServerNames,
  mergeYamlEntry,
  parseYamlMcpServerEntry,
  removeYamlEntry,
} = await loadAgentConfigBundle();
