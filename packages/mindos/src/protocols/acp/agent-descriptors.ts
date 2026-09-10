/**
 * ACP Agent Descriptors — command resolution, detection input, and user overrides.
 *
 * The descriptor table itself (`AGENT_DESCRIPTORS`, `AGENT_ALIASES`, curated
 * names, `packageName` derivation) lives in
 * `agent/runtime/agent-descriptor-table.ts` and is re-exported here so existing
 * importers of `@geminilight/mindos/protocols/acp` keep working. This module
 * layers user overrides and registry fallbacks on top of that table and turns
 * it into the list local detection probes.
 */

import type { AcpRegistryEntry, AcpTransportType } from './types.js';
import {
  AGENT_ALIASES,
  AGENT_DESCRIPTORS,
  resolveAlias,
  type AcpAgentOverride,
} from '../../agent/runtime/agent-descriptor-table.js';
import { isSafeAgentId } from '../../agent/runtime/acp-overrides.js';
import type { AcpAgentAdapterMetadata } from '../../agent/runtime/adapter-metadata.js';

export {
  AGENT_ALIASES,
  AGENT_DESCRIPTORS,
  getDescriptorAliases,
  getDescriptorBinary,
  getDescriptorDescription,
  getDescriptorDisplayName,
  getDescriptorInstallCmd,
  getDescriptorPackageName,
  packageNameFromInstallCmd,
  resolveAlias,
} from '../../agent/runtime/agent-descriptor-table.js';
export type {
  AcpAgentDescriptor,
  AcpAgentOverride,
} from '../../agent/runtime/agent-descriptor-table.js';
export { sanitizeAdapterMetadata } from '../../agent/runtime/adapter-metadata.js';
export { isSafeAgentId, isSafeEnvKey, parseAcpAgentOverrides } from '../../agent/runtime/acp-overrides.js';
export type {
  AcpAgentAdapterCommandDeclaration,
  AcpAgentAdapterMetadata,
  AcpAgentAdapterModelDeclaration,
  AcpAgentAdapterSessionCapabilities,
} from '../../agent/runtime/adapter-metadata.js';

/* ── Types ─────────────────────────────────────────────────────────────── */

/** Fully resolved command ready for spawn, with provenance. */
export interface ResolvedAgentCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  /** Where the command came from */
  source: 'user-override' | 'descriptor' | 'registry';
  /** Binary name for detection */
  binary: string;
  /** Install command for UI */
  installCmd?: string;
  /** Whether agent is enabled */
  enabled: boolean;
}

/* ── Resolution ────────────────────────────────────────────────────────── */

/**
 * Resolve the final command for an agent by layering:
 *   1. User override (highest priority)
 *   2. Built-in descriptor
 *   3. Registry entry (fallback for unknown agents)
 *   4. Transport-based default (last resort)
 */
export function resolveAgentCommand(
  agentId: string,
  registryEntry?: AcpRegistryEntry,
  userOverride?: AcpAgentOverride,
): ResolvedAgentCommand {
  const descriptor = AGENT_DESCRIPTORS[resolveAlias(agentId)];
  const enabled = userOverride?.enabled !== false;

  // Layer 1: User override
  if (userOverride && (userOverride.command || userOverride.args)) {
    return {
      cmd: userOverride.command ?? descriptor?.cmd ?? registryEntry?.command ?? agentId,
      args: userOverride.args ?? descriptor?.args ?? [],
      env: userOverride.env,
      source: 'user-override',
      binary: descriptor?.binary ?? agentId,
      installCmd: descriptor?.installCmd,
      enabled,
    };
  }

  // Layer 2: Built-in descriptor
  if (descriptor) {
    return {
      cmd: descriptor.cmd,
      args: descriptor.args,
      env: userOverride?.env,
      source: 'descriptor',
      binary: descriptor.binary,
      installCmd: descriptor.installCmd,
      enabled,
    };
  }

  // Layer 3: Registry entry
  if (registryEntry) {
    const { cmd, args } = registryToCommand(registryEntry);
    return {
      cmd,
      args,
      env: userOverride?.env,
      source: 'registry',
      binary: agentId,
      installCmd: registryEntry.packageName ? `npm install -g ${registryEntry.packageName}` : undefined,
      enabled,
    };
  }

  // Layer 4: Last resort — try using agentId as command
  return {
    cmd: agentId,
    args: [],
    env: userOverride?.env,
    source: 'registry',
    binary: agentId,
    enabled,
  };
}

/** Convert a registry entry's transport info to a spawn command. */
function registryToCommand(entry: AcpRegistryEntry): { cmd: string; args: string[] } {
  const transport: AcpTransportType = entry.transport;
  switch (transport) {
    case 'npx':
      return { cmd: 'npx', args: ['--yes', entry.command, ...(entry.args ?? [])] };
    case 'uvx':
      return { cmd: 'uvx', args: [entry.command, ...(entry.args ?? [])] };
    case 'binary':
    case 'stdio':
    default:
      return { cmd: entry.command, args: entry.args ?? [] };
  }
}

/* ── Detection ─────────────────────────────────────────────────────────── */

/** Agent info needed for local binary detection (no CDN dependency). */
export interface DetectableAgent {
  id: string;
  name: string;
  binary: string;
  detectCommands?: string[];
  presenceDirs?: string[];
  installCmd?: string;
  description?: string;
  adapterMetadata?: AcpAgentAdapterMetadata;
  source: 'descriptor' | 'user-config';
}

/**
 * Return the canonical list of agents for local detection.
 * Pure local data — no CDN fetch, no async, no network dependency.
 */
export function getDetectableAgents(overrides?: Record<string, AcpAgentOverride>): DetectableAgent[] {
  return [
    ...Object.entries(AGENT_DESCRIPTORS).map(([id, desc]) => ({
      id,
      name: desc.displayName ?? id,
      binary: desc.binary,
      detectCommands: desc.detectCommands,
      presenceDirs: desc.presenceDirs,
      installCmd: desc.installCmd,
      description: desc.description,
      adapterMetadata: desc.adapterMetadata,
      source: 'descriptor' as const,
    })),
    ...getConfiguredDetectableAgents(overrides),
  ];
}

/**
 * Look up user override for an agent, checking canonical ID, alias → canonical,
 * and reverse alias (canonical → any alias) so users can configure with any name.
 */
export function findUserOverride(
  agentId: string,
  overrides?: Record<string, AcpAgentOverride>,
): AcpAgentOverride | undefined {
  if (!overrides) return undefined;
  if (overrides[agentId]) return overrides[agentId];
  const canonical = resolveAlias(agentId);
  if (canonical !== agentId && overrides[canonical]) return overrides[canonical];
  for (const [alias, target] of Object.entries(AGENT_ALIASES)) {
    if (target === agentId && overrides[alias]) return overrides[alias];
  }
  return undefined;
}

/** Return user-configured ACP agents that are not built into MindOS. */
export function getConfiguredDetectableAgents(
  overrides?: Record<string, AcpAgentOverride>,
): DetectableAgent[] {
  if (!overrides) return [];
  const agents: DetectableAgent[] = [];
  for (const [agentId, override] of Object.entries(overrides)) {
    const agent = overrideToDetectableAgent(agentId, override);
    if (agent) agents.push(agent);
  }
  return agents;
}

/** Convert a user-configured custom ACP agent into a registry entry for runtime launch. */
export function resolveConfiguredAcpAgentEntry(
  agentId: string,
  overrides?: Record<string, AcpAgentOverride>,
): AcpRegistryEntry | null {
  if (!isSafeAgentId(agentId)) return null;
  const override = findUserOverride(agentId, overrides);
  if (!isCustomAcpAgentOverride(agentId, override)) return null;
  return {
    id: agentId,
    name: override.name ?? agentId,
    description: override.description ?? '',
    transport: 'stdio',
    command: override.command,
    args: override.args ?? [],
    env: override.env,
  };
}

function isCustomAcpAgentOverride(
  agentId: string,
  override: AcpAgentOverride | undefined,
): override is AcpAgentOverride & { command: string } {
  if (!override || override.enabled === false || !override.command) return false;
  return !AGENT_DESCRIPTORS[resolveAlias(agentId)];
}

function overrideToDetectableAgent(
  agentId: string,
  override: AcpAgentOverride,
): DetectableAgent | null {
  if (!isSafeAgentId(agentId)) return null;
  if (!isCustomAcpAgentOverride(agentId, override)) return null;
  const command = override.command.trim();
  const detectCommands = override.detectCommands ?? [command];
  return {
    id: agentId,
    name: override.name ?? agentId,
    binary: detectCommands[0] ?? command,
    detectCommands,
    presenceDirs: override.presenceDirs,
    installCmd: override.installCmd,
    description: override.description,
    adapterMetadata: override.adapterMetadata,
    source: 'user-config',
  };
}
