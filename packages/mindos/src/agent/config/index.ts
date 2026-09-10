/**
 * Agent-config layer: the single implementation of "where does this agent
 * keep its MCP config, how do we read / write it, is the agent installed, and
 * where do its skills go".
 *
 * Consumers:
 * - product server handlers (`server/handlers/mcp-*.ts`, `skills.ts`) import it directly;
 * - the Web host reaches it through `@geminilight/mindos/server`;
 * - the CLI loads the esbuild bundle `bin/lib/generated/agent-config.mjs`
 *   produced from this file by `scripts/build-cli-bundles.mjs` (Bun single
 *   binaries cannot resolve bare npm specifiers, so `jsonc-parser` is inlined
 *   and only `node:*` imports remain).
 *
 * Keep this module free of `server/`, `agent/runtime/` and protocol imports:
 * everything here must stay bundleable for the CLI.
 */

export * from './types.js';
export * from './registry.js';
export * from './text.js';
export {
  buildTomlEntry,
  listTomlServerNames,
  mergeTomlEntry,
  parseTomlMcpServerEntry,
  removeTomlEntry,
} from './toml.js';
export {
  buildYamlEntry,
  listYamlServerNames,
  mergeYamlEntry,
  parseYamlMcpServerEntry,
  removeYamlEntry,
} from './yaml.js';
export {
  assertSafeMcpServerName,
  assertSafeObjectKey,
  assertSafeObjectKeyPath,
  detectConfigFormat,
  getNestedPath,
  listMcpServerNamesFromText,
  readJsonConfigDocument,
  readMcpServerEntryFromText,
  readOwnRecord,
  removeMcpServerEntryFromFile,
  writeFileAtomically,
  writeMcpServerEntryToFile,
  type JsonConfigDocument,
  type McpConfigFormat,
} from './formats.js';
export {
  parseJsonc,
  parseJsoncDocument,
  removeJsoncValue,
  setJsoncValue,
  type JsoncDocument,
} from '../../foundation/shared/utils/jsonc.js';
export * from './paths.js';
export * from './entry.js';
export * from './probes.js';
export * from './config-read.js';
export * from './presence.js';
export * from './skill-workspace.js';
export * from './skill-link.js';
export * from './adapter.js';
export * from './install-transaction.js';
