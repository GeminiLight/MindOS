/**
 * JSONC helpers for the CLI.
 *
 * Generated-bundle mirror: the implementation lives in
 * `src/foundation/shared/utils/jsonc.ts` (jsonc-parser inlined by esbuild, so
 * the Bun single binary needs no bare-specifier resolution) and reaches the
 * CLI through `bin/lib/generated/agent-config.mjs` (see `agent-config.js`).
 *
 * VS Code-based editors (Cursor, Windsurf, Cline, Kilo) use JSONC for config
 * files; Windows editors (Notepad) may prepend a UTF-8 BOM. Reads tolerate
 * comments, trailing commas and a BOM; writes edit the original text in place
 * so user comments and formatting survive.
 */
import { loadAgentConfigBundle } from './agent-config.js';

export const {
  parseJsonc,
  parseJsoncDocument,
  removeJsoncValue,
  setJsoncValue,
  stripBom,
} = await loadAgentConfigBundle();
