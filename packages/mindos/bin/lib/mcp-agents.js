/**
 * Shared MCP agent definitions for CLI tools.
 *
 * Generated-bundle mirror: the registry, the skill-install registry and the
 * presence probes live in `src/agent/config/` (the SAME source the product
 * server and Web host import) and reach the CLI through
 * `bin/lib/generated/agent-config.mjs` (see `agent-config.js`). There is no
 * hand-copied registry here any more — `tests/agent-registry-contract.test.ts`
 * asserts this file derives from the core table.
 *
 * `MCP_AGENTS` excludes the `mindos` self row: CLI commands iterate it to find
 * downstream agents to install into.
 */
import { loadAgentConfigBundle } from './agent-config.js';

const {
  DEFAULT_MCP_AGENTS,
  DEFAULT_SKILL_AGENT_REGISTRY,
  detectAgentPresenceUncached,
  listDownstreamAgentDefs,
  resolveAgentConfigProbes,
} = await loadAgentConfigBundle();

/** Built-in downstream agents (everything except the `mindos` self row). */
export const MCP_AGENTS = listDownstreamAgentDefs(DEFAULT_MCP_AGENTS);

/** Skill-install registry keyed by MCP agent key. */
export const SKILL_AGENT_REGISTRY = DEFAULT_SKILL_AGENT_REGISTRY;

/**
 * Whether `agentKey` is installed on this machine. The CLI is one-shot, so this
 * deliberately bypasses the server's process-wide presence cache (a stale hit
 * would be wrong for a fresh `mindos doctor` run) and probes the real
 * filesystem / PATH directly.
 */
export function detectAgentPresence(agentKey) {
  const def = MCP_AGENTS[agentKey];
  if (!def) return false;
  return detectAgentPresenceUncached(def, resolveAgentConfigProbes());
}
