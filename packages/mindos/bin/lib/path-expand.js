/**
 * Path expansion — resolve `~`, `~/...` or `~\...` to absolute paths.
 *
 * Generated-bundle mirror: the implementation lives in
 * `src/foundation/shared/utils/path.ts` and reaches the CLI through
 * `bin/lib/generated/agent-config.mjs` (see `agent-config.js`).
 */
import { loadAgentConfigBundle } from './agent-config.js';

export const { expandHome } = await loadAgentConfigBundle();
