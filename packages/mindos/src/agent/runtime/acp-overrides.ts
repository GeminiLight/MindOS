/**
 * ACP agent override parsing — runtime-layer home.
 *
 * `parseAcpAgentOverrides` validates `acpAgents` settings entries and
 * extension-manifest `contributes.acpAdapters` into `AcpAgentOverride`
 * records. Every collaborator it needs (descriptor table, adapter-metadata
 * sanitizers) already lives in `agent/runtime`, so the parser lives here too
 * and `protocols/acp/agent-descriptors.ts` re-exports it for the public
 * `@geminilight/mindos/protocols/acp` surface. This is what lets
 * `extension-manifest.ts` drop its documented layering exception
 * (spec-plugin-primitives / spec-runtime-descriptor-single-source): the
 * runtime layer never reaches into `protocols/` for override parsing.
 */

import {
  isRecord,
  sanitizeAdapterMetadata,
  sanitizeOptionalString,
  sanitizeStringArray,
} from './adapter-metadata.js';
import type { AcpAgentOverride } from './agent-descriptor-table.js';
import { safePluginIdentifierIssue } from '../../foundation/plugins/safe-id.js';

/** Parse and validate acpAgents config from raw settings JSON or an extension manifest. */
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

/** True for ids that may key an override record or name an agent launch target. */
export function isSafeAgentId(agentId: string): boolean {
  // Shared identifier rules (foundation/plugins/safe-id): first char
  // alphanumeric, inner [A-Za-z0-9._-], no dot segments, separators, Windows
  // drives/reserved names, prototype keys, control chars; capped at 64.
  return safePluginIdentifierIssue(agentId, { allowDots: true, maxLength: 64 }) === undefined;
}

export function isSafeEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    && key !== '__proto__'
    && key !== 'constructor'
    && key !== 'prototype';
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
