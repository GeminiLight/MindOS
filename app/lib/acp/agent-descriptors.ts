/**
 * ACP Agent Descriptors — Single source of truth for agent detection, launch, and install.
 * Replaces the previously separate AGENT_BINARY_MAP, AGENT_OVERRIDES, and INSTALL_COMMANDS maps.
 */

import type { AcpRegistryEntry, AcpTransportType } from './types';

/* ── Types ─────────────────────────────────────────────────────────────── */

/** Complete agent launch/detection metadata. */
export interface AcpAgentDescriptor {
  /** Binary name for `which` detection (e.g., "gemini", "codebuddy") */
  binary: string;
  /** Command to execute when spawning */
  cmd: string;
  /** CLI args for ACP mode */
  args: string[];
  /** Install command shown in UI / used by auto-install */
  installCmd?: string;
}

/** User override for a specific agent, persisted in settings. */
export interface AcpAgentOverride {
  /** Override command path (e.g., "/usr/local/bin/gemini") */
  command?: string;
  /** Override CLI args (e.g., ["--acp", "--verbose"]) */
  args?: string[];
  /** Extra environment variables */
  env?: Record<string, string>;
  /** false = skip this agent entirely (default: true) */
  enabled?: boolean;
}

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

/* ── Canonical Descriptors ─────────────────────────────────────────────── */

/**
 * All known ACP agents with their detection binary, launch command, and install hint.
 * Both detection (`which binary?`) and launch (`spawn cmd args`) read from here.
 */
export const AGENT_DESCRIPTORS: Record<string, AcpAgentDescriptor> = {
  // Gemini CLI — requires --experimental-acp flag
  'gemini':          { binary: 'gemini',          cmd: 'gemini',    args: ['--experimental-acp'], installCmd: 'npm install -g @google/gemini-cli' },
  'gemini-cli':      { binary: 'gemini',          cmd: 'gemini',    args: ['--experimental-acp'], installCmd: 'npm install -g @google/gemini-cli' },
  // Claude Code — uses separate ACP wrapper package
  'claude':          { binary: 'claude',          cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code' },
  'claude-code':     { binary: 'claude',          cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code' },
  'claude-acp':      { binary: 'claude',          cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code' },
  // CodeBuddy Code — local binary with --acp flag
  'codebuddy-code':  { binary: 'codebuddy',       cmd: 'codebuddy', args: ['--acp'], installCmd: 'npm install -g @anthropic-ai/claude-code' },
  'codebuddy':       { binary: 'codebuddy',       cmd: 'codebuddy', args: ['--acp'], installCmd: 'npm install -g @anthropic-ai/claude-code' },
  // Codex
  'codex-acp':       { binary: 'codex',           cmd: 'codex',     args: [],        installCmd: 'npm install -g @openai/codex' },
  'codex':           { binary: 'codex',           cmd: 'codex',     args: [],        installCmd: 'npm install -g @openai/codex' },
  // Others
  'cursor':          { binary: 'cursor',          cmd: 'cursor',    args: [] },
  'cline':           { binary: 'cline',           cmd: 'cline',     args: [],        installCmd: 'npm install -g cline' },
  'github-copilot-cli': { binary: 'github-copilot', cmd: 'github-copilot', args: [], installCmd: 'npm install -g @github/copilot' },
  'goose':           { binary: 'goose',           cmd: 'goose',     args: [],        installCmd: 'pip install goose-ai' },
  'opencode':        { binary: 'opencode',        cmd: 'opencode',  args: [],        installCmd: 'go install github.com/opencode-ai/opencode@latest' },
  'kilo':            { binary: 'kilo',            cmd: 'kilo',      args: [],        installCmd: 'npm install -g @kilocode/cli' },
  'openclaw':        { binary: 'openclaw',        cmd: 'openclaw',  args: [] },
  'pi':              { binary: 'pi',              cmd: 'pi',        args: [] },
  'pi-acp':          { binary: 'pi',              cmd: 'pi',        args: [] },
  'auggie':          { binary: 'auggie',          cmd: 'auggie',    args: [] },
  'iflow':           { binary: 'iflow',           cmd: 'iflow',     args: [] },
  'kimi':            { binary: 'kimi',            cmd: 'kimi',      args: [] },
  'qwen-code':       { binary: 'qwen-code',       cmd: 'qwen-code', args: [], installCmd: 'npm install -g @qwen-code/qwen-code' },
};

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
  const descriptor = AGENT_DESCRIPTORS[agentId];
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

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Get the binary name for detection (used by detect endpoint). */
export function getDescriptorBinary(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[agentId]?.binary;
}

/** Get the install command for UI display. */
export function getDescriptorInstallCmd(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[agentId]?.installCmd;
}

/** Parse and validate acpAgents config from raw settings JSON. */
export function parseAcpAgentOverrides(raw: unknown): Record<string, AcpAgentOverride> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, AcpAgentOverride> = {};
  let hasEntries = false;

  for (const [key, val] of Object.entries(obj)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const entry = val as Record<string, unknown>;
    const override: AcpAgentOverride = {};

    if (typeof entry.command === 'string' && entry.command.trim()) {
      override.command = entry.command.trim();
    }
    if (Array.isArray(entry.args)) {
      override.args = entry.args.filter((a): a is string => typeof a === 'string');
    }
    if (entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)) {
      const env: Record<string, string> = {};
      for (const [ek, ev] of Object.entries(entry.env as Record<string, unknown>)) {
        if (typeof ev === 'string') env[ek] = ev;
      }
      if (Object.keys(env).length > 0) override.env = env;
    }
    if (typeof entry.enabled === 'boolean') {
      override.enabled = entry.enabled;
    }

    if (Object.keys(override).length > 0) {
      result[key] = override;
      hasEntries = true;
    }
  }

  return hasEntries ? result : undefined;
}
