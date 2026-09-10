/**
 * The two native runtimes MindOS drives directly (Codex app-server, Claude
 * Code SDK/CLI bridge). Everything an ACP descriptor already knows about the
 * same agent (name, binary, install command, presence directories, aliases)
 * is read from `agent-descriptor-table.ts`; this file only adds the facts that
 * exist because the runtime is native (capabilities, bridge kind, MCP agent
 * key, diagnostics wording).
 */

import {
  AGENT_DESCRIPTORS,
  getDescriptorAliases,
  packageNameFromInstallCmd,
} from './agent-descriptor-table.js';
import {
  claudeCapabilities,
  claudeHarnessCapabilities,
  codexCapabilities,
  codexHarnessCapabilities,
} from './capabilities.js';
import type {
  AgentRuntimeBridge,
  AgentRuntimeCapabilities,
  AgentRuntimeHarnessCapabilities,
  NativeRuntimeId,
} from './registry.js';

export type NativeRuntimeDefinition = {
  /** MindOS runtime id (`codex` / `claude`); also the runtime descriptor id. */
  runtime: NativeRuntimeId;
  /** Canonical key in AGENT_DESCRIPTORS this runtime is derived from; detection reports agents under this id. */
  id: string;
  name: string;
  /** Command probed on PATH; equals the descriptor binary. */
  command: string;
  installCmd: string;
  packageName?: string;
  /** Every id detection may report for this runtime: descriptor id, its aliases, and the runtime id. */
  aliases: string[];
  presenceDirs: string[];
  /** Key in the MCP agent registry (`mcp-agents`) that owns this runtime's MCP config. */
  mcpAgentKey: string;
  description: string;
  /** Bridge assumed when health did not report one. */
  defaultBridge: AgentRuntimeBridge['kind'];
  capabilities: AgentRuntimeCapabilities;
  harnessCapabilities: AgentRuntimeHarnessCapabilities;
  diagnostics: {
    /** Hint shown when the runtime is installed but signed out. */
    signedOut: string;
    /** Hint shown when the runtime health probe failed for another reason. */
    health: string;
  };
};

type NativeRuntimeFacts = Pick<
  NativeRuntimeDefinition,
  'runtime' | 'id' | 'mcpAgentKey' | 'description' | 'defaultBridge' | 'capabilities' | 'harnessCapabilities' | 'diagnostics'
>;

function defineNativeRuntime(facts: NativeRuntimeFacts): NativeRuntimeDefinition {
  const descriptor = AGENT_DESCRIPTORS[facts.id];
  if (!descriptor) throw new Error(`Native runtime ${facts.runtime} points at unknown descriptor ${facts.id}`);
  if (!descriptor.installCmd) throw new Error(`Native runtime ${facts.runtime} needs an installCmd on descriptor ${facts.id}`);
  return {
    ...facts,
    name: descriptor.displayName ?? facts.id,
    command: descriptor.binary,
    installCmd: descriptor.installCmd,
    packageName: packageNameFromInstallCmd(descriptor.installCmd),
    aliases: Array.from(new Set([...getDescriptorAliases(facts.id), facts.runtime])),
    presenceDirs: descriptor.presenceDirs ?? [],
  };
}

export const NATIVE_RUNTIME_DEFINITIONS: readonly NativeRuntimeDefinition[] = [
  defineNativeRuntime({
    runtime: 'codex',
    id: 'codex-acp',
    mcpAgentKey: 'codex',
    description: 'Local Codex app-server runtime. Model, approval, and thread behavior are owned by Codex.',
    defaultBridge: 'codex-app-server',
    capabilities: codexCapabilities,
    harnessCapabilities: codexHarnessCapabilities,
    diagnostics: {
      signedOut: 'Run "codex login status" from the same environment that starts MindOS.',
      health: 'Run "codex app-server --help" from the MindOS server environment.',
    },
  }),
  defineNativeRuntime({
    runtime: 'claude',
    id: 'claude',
    mcpAgentKey: 'claude-code',
    description: 'Local Claude Code runtime. Model, permission, and session behavior are owned by Claude Code.',
    defaultBridge: 'claude-sdk',
    capabilities: claudeCapabilities,
    harnessCapabilities: claudeHarnessCapabilities,
    diagnostics: {
      signedOut: 'Run Claude Code once from the same environment that starts MindOS.',
      health: 'Run "claude --version" from the MindOS server environment.',
    },
  }),
];

export function nativeRuntimeDefinition(runtime: NativeRuntimeId): NativeRuntimeDefinition {
  const definition = NATIVE_RUNTIME_DEFINITIONS.find((candidate) => candidate.runtime === runtime);
  if (!definition) throw new Error(`Unsupported native runtime: ${runtime}`);
  return definition;
}

/** A detected or missing agent belongs to a native runtime when its id is a table alias or its name says so. */
export function matchesNativeRuntime(
  agent: { id: string; name: string },
  definition: NativeRuntimeDefinition,
): boolean {
  return definition.aliases.includes(agent.id) || agent.name.toLowerCase().includes(definition.runtime);
}

export function nativeRuntimeIdForAgent(agent: { id: string; name: string }): NativeRuntimeId | null {
  return NATIVE_RUNTIME_DEFINITIONS.find((definition) => matchesNativeRuntime(agent, definition))?.runtime ?? null;
}
