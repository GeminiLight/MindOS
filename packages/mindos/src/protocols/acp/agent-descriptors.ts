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
import {
  isRecord,
  sanitizeAdapterMetadata,
  sanitizeOptionalString,
  sanitizeStringArray,
  type AcpAgentAdapterMetadata,
} from '../../agent/runtime/adapter-metadata.js';

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

/** Parse and validate acpAgents config from raw settings JSON. */
export function parseAcpAgentOverrides(raw: unknown): Record<string, AcpAgentOverride> | undefined {
  const entries = normalizeAcpAgentOverrideEntries(raw);
  if (!entries) return undefined;
  const result: Record<string, AcpAgentOverride> = {};
  let hasEntries = false;

  for (const [key, entry] of entries) {
    if (!isSafeAgentId(key)) continue;
    const override: AcpAgentOverride = {};

    const name = sanitizeOptionalString(entry.name, 80);
    if (name) override.name = name;
    const description = sanitizeOptionalString(entry.description, 500);
    if (description) override.description = description;
    const command = sanitizeOptionalString(entry.command ?? entry.cliCommand ?? entry.defaultCliPath, 500);
    if (command) {
      override.command = command;
    }
    if (Array.isArray(entry.args) || Array.isArray(entry.acpArgs)) {
      const args = sanitizeStringArray(entry.args ?? entry.acpArgs, 100, 500);
      if (args) override.args = args;
    }
    if (entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)) {
      const env: Record<string, string> = {};
      for (const [ek, ev] of Object.entries(entry.env as Record<string, unknown>)) {
        if (isSafeEnvKey(ek) && typeof ev === 'string') env[ek] = ev;
      }
      if (Object.keys(env).length > 0) override.env = env;
    }
    if (typeof entry.enabled === 'boolean') {
      override.enabled = entry.enabled;
    }
    const detectCommands = sanitizeStringArray(
      entry.detectCommands ?? (entry.cliCommand ? [entry.cliCommand] : undefined),
      16,
      160,
    );
    if (detectCommands) override.detectCommands = detectCommands;
    const presenceDirs = sanitizeStringArray(entry.presenceDirs, 16, 500);
    if (presenceDirs) override.presenceDirs = presenceDirs;
    const installCmd = sanitizeOptionalString(entry.installCmd, 500);
    if (installCmd) override.installCmd = installCmd;
    const adapterMetadata = sanitizeAdapterMetadata(mergeAdapterMetadataInput(entry));
    if (adapterMetadata) override.adapterMetadata = adapterMetadata;

    if (Object.keys(override).length > 0) {
      result[key] = override;
      hasEntries = true;
    }
  }

  return hasEntries ? result : undefined;
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

function isSafeEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    && key !== '__proto__'
    && key !== 'constructor'
    && key !== 'prototype';
}

function isSafeAgentId(agentId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agentId)
    && agentId !== '__proto__'
    && agentId !== 'constructor'
    && agentId !== 'prototype';
}

function normalizeAcpAgentOverrideEntries(raw: unknown): Array<[string, Record<string, unknown>]> | undefined {
  const contributedAdapters = extractContributedAcpAdapters(raw);
  if (contributedAdapters) {
    const entries = contributedAdapters
      .map((adapter): [string, Record<string, unknown>] | null => {
        const id = sanitizeOptionalString(adapter.id, 120);
        return id ? [id, adapter] : null;
      })
      .filter((entry): entry is [string, Record<string, unknown>] => entry !== null);
    return entries.length > 0 ? entries : undefined;
  }

  if (!isRecord(raw)) return undefined;
  return Object.entries(raw)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
}

function extractContributedAcpAdapters(raw: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(raw)) {
    const entries = raw.filter(isRecord);
    return entries.length > 0 ? entries : undefined;
  }
  if (!isRecord(raw)) return undefined;
  const contributes = isRecord(raw.contributes) ? raw.contributes : undefined;
  const candidates = Array.isArray(raw.acpAdapters)
    ? raw.acpAdapters
    : Array.isArray(contributes?.acpAdapters)
      ? contributes.acpAdapters
      : undefined;
  if (!candidates) return undefined;
  const entries = candidates.filter(isRecord);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Settings entries and extension manifests may declare adapter metadata either
 * nested under `adapterMetadata` or flat on the entry; fold both into one
 * object for the shared sanitiser (nested wins).
 */
function mergeAdapterMetadataInput(entry: Record<string, unknown>): unknown {
  const nested = isRecord(entry.adapterMetadata) ? entry.adapterMetadata : {};
  return {
    ...nested,
    connectionType: nested.connectionType ?? entry.connectionType,
    authRequired: nested.authRequired ?? entry.authRequired,
    supportsStreaming: nested.supportsStreaming ?? entry.supportsStreaming,
    models: nested.models ?? entry.models,
    promptCapabilities: nested.promptCapabilities ?? entry.promptCapabilities,
    mcpCapabilities: nested.mcpCapabilities ?? entry.mcpCapabilities,
    sessionCapabilities: nested.sessionCapabilities ?? entry.sessionCapabilities,
    output: nested.output ?? nested.outputCapabilities ?? entry.output ?? entry.outputCapabilities,
    kinds: nested.kinds ?? entry.kinds,
    outputKinds: nested.outputKinds ?? entry.outputKinds,
    reviewableOutputKinds: nested.reviewableOutputKinds ?? entry.reviewableOutputKinds,
    fileChanges: nested.fileChanges ?? entry.fileChanges,
    artifacts: nested.artifacts ?? entry.artifacts,
    checkpoints: nested.checkpoints ?? entry.checkpoints,
    branches: nested.branches ?? entry.branches,
    pullRequests: nested.pullRequests ?? entry.pullRequests,
    healthCheck: nested.healthCheck ?? entry.healthCheck,
    commands: nested.commands ?? entry.commands,
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
