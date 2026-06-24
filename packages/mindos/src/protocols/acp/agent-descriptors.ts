/**
 * ACP Agent Descriptors — Single source of truth for agent detection, launch, and install.
 * Replaces the previously separate AGENT_BINARY_MAP, AGENT_OVERRIDES, and INSTALL_COMMANDS maps.
 */

import type { AcpRegistryEntry, AcpTransportType } from './types.js';

/* ── Types ─────────────────────────────────────────────────────────────── */

/** Complete agent launch/detection metadata. */
export interface AcpAgentDescriptor {
  /** Primary binary name for detection and legacy callers */
  binary: string;
  /** Additional command names to probe on PATH */
  detectCommands?: string[];
  /** Presence directories/config paths used as a fallback signal when PATH probing fails */
  presenceDirs?: string[];
  /** Command to execute when spawning */
  cmd: string;
  /** CLI args for ACP mode */
  args: string[];
  /** Install command shown in UI / used by auto-install */
  installCmd?: string;
  /** Curated display name (overrides registry name) */
  displayName?: string;
  /** Curated description (overrides registry description) */
  description?: string;
}

export interface AcpAgentAdapterCommandDeclaration {
  name: string;
  description?: string;
}

export interface AcpAgentAdapterMetadata {
  healthCheck?: {
    command?: string;
    timeoutMs?: number;
    summary?: string;
  };
  commands?: AcpAgentAdapterCommandDeclaration[];
}

/** User override for a specific agent, persisted in settings. */
export interface AcpAgentOverride {
  /** Optional display name for custom ACP agents. Built-in descriptors still own curated names. */
  name?: string;
  /** Optional description for custom ACP agents. */
  description?: string;
  /** Override command path (e.g., "/usr/local/bin/gemini") */
  command?: string;
  /** Override CLI args (e.g., ["--acp", "--verbose"]) */
  args?: string[];
  /** Extra environment variables */
  env?: Record<string, string>;
  /** Additional command names to probe on PATH for custom ACP agents */
  detectCommands?: string[];
  /** Presence directories/config paths used as a fallback signal when PATH probing fails */
  presenceDirs?: string[];
  /** Install command shown in UI when a custom ACP agent is not detected */
  installCmd?: string;
  /** Non-sensitive adapter contract metadata surfaced in runtime diagnostics. */
  adapterMetadata?: AcpAgentAdapterMetadata;
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

/* ── Aliases ───────────────────────────────────────────────────────────── */

/**
 * Maps alternative agent IDs to their canonical ID in AGENT_DESCRIPTORS.
 * This eliminates full duplicate entries while maintaining backward compatibility.
 */
export const AGENT_ALIASES: Record<string, string> = {
  'gemini-cli':  'gemini',
  'claude-code': 'claude',
  'claude-acp':  'claude',
  'codebuddy':   'codebuddy-code',
  'codex':       'codex-acp',
  'pi-acp':      'pi',
};

/** Resolve an agent ID to its canonical form (idempotent for canonical IDs). */
export function resolveAlias(agentId: string): string {
  return AGENT_ALIASES[agentId] ?? agentId;
}

/* ── Canonical Descriptors ─────────────────────────────────────────────── */

/**
 * All known ACP agents with their detection binary, launch command, and install hint.
 * Only canonical entries — aliases are handled by AGENT_ALIASES above.
 */
export const AGENT_DESCRIPTORS: Record<string, AcpAgentDescriptor> = {
  'gemini':          { binary: 'gemini',          detectCommands: ['gemini'],      presenceDirs: ['~/.gemini/'], cmd: 'gemini',    args: ['--experimental-acp'], installCmd: 'npm install -g @google/gemini-cli',
    displayName: 'Gemini CLI',
    description: 'Google Gemini 驱动的编程智能体。支持多文件编辑、代码审查、调试和项目级重构，原生集成 Google 搜索实时查询技术文档。' },
  'claude':          { binary: 'claude',          detectCommands: ['claude'],      presenceDirs: ['~/.claude/'], cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic Claude 驱动的编程智能体。擅长复杂推理、长上下文理解和安全代码生成，支持多文件编辑与 agentic 工作流。' },
  'codebuddy-code':  { binary: 'codebuddy',       detectCommands: ['codebuddy'],   presenceDirs: ['~/.codebuddy/'], cmd: 'codebuddy', args: ['--acp'], installCmd: 'npm install -g @tencent-ai/codebuddy-code',
    displayName: 'CodeBuddy Code',
    description: '腾讯云智能编程助手。基于混元大模型，支持代码补全、生成、审查和多文件重构，深度理解中文语境，适配国内开发生态。' },
  'codex-acp':       { binary: 'codex',           detectCommands: ['codex'],       presenceDirs: ['~/.codex/'], cmd: 'codex',     args: [],        installCmd: 'npm install -g @openai/codex',
    displayName: 'Codex',
    description: 'OpenAI Codex 编程智能体。基于 GPT 系列模型，擅长代码生成、自动化任务和多语言编程支持。' },
  'cursor':          { binary: 'cursor',          detectCommands: ['cursor'],      presenceDirs: ['~/.cursor/extensions/'], cmd: 'cursor',    args: [],
    displayName: 'Cursor',
    description: 'Cursor AI 编程智能体。AI-first 代码编辑器的 CLI 模式，支持上下文感知的代码编辑、Tab 补全和多文件协同修改。' },
  'cline':           { binary: 'cline',           detectCommands: ['cline'],       presenceDirs: ['~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/', '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/', '%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/'], cmd: 'cline',     args: [],        installCmd: 'npm install -g cline',
    displayName: 'Cline',
    description: '开源自主编程智能体。支持多模型后端，内置文件编辑、终端执行和浏览器自动化能力。' },
  'github-copilot-cli': { binary: 'github-copilot', cmd: 'github-copilot', args: [], installCmd: 'npm install -g @github/copilot',
    displayName: 'GitHub Copilot',
    description: 'GitHub Copilot 编程智能体。基于海量开源代码训练，擅长代码补全、测试生成和跨语言编程支持。' },
  'goose':           { binary: 'goose',           cmd: 'goose',     args: [],        installCmd: 'pip install goose-ai',
    displayName: 'Goose',
    description: 'Block 开源自主编程智能体。支持多模型后端，可扩展插件架构，擅长复杂任务自动化。' },
  'opencode':        { binary: 'opencode',        cmd: 'opencode',  args: [],        installCmd: 'go install github.com/opencode-ai/opencode@latest',
    displayName: 'OpenCode',
    description: '开源终端编程智能体。Go 实现，轻量快速，支持多模型后端和丰富的代码编辑工具。' },
  'kilo':            { binary: 'kilo',            cmd: 'kilo',      args: [],        installCmd: 'npm install -g @kilocode/cli',
    displayName: 'Kilo Code',
    description: 'Kilo Code 编程智能体。开源 VS Code 扩展的 CLI 模式，支持多模型、自动审批和代码差异预览。' },
  'openclaw':        { binary: 'openclaw',        detectCommands: ['openclaw'],    presenceDirs: ['~/.openclaw/'], cmd: 'openclaw',  args: [],
    displayName: 'OpenClaw',
    description: 'OpenClaw 编程智能体。开源 Claude Code 替代方案，支持多模型后端和完整的 agentic 工作流。' },
  'pi':              { binary: 'pi',              detectCommands: ['pi'],          presenceDirs: ['~/.pi/'], cmd: 'pi',        args: [],
    displayName: 'Pi Agent',
    description: 'Pi Agent 编程智能体。轻量级终端编程助手。' },
  'auggie':          { binary: 'auggie',          detectCommands: ['auggie'],      presenceDirs: ['~/.augment/'], cmd: 'auggie',    args: [],
    displayName: 'Auggie',
    description: 'Augment Code 编程智能体。支持代码理解、生成和全仓库上下文感知。' },
  'kimi':            { binary: 'kimi',            detectCommands: ['kimi'],        presenceDirs: ['~/.kimi/'], cmd: 'kimi',      args: [],
    displayName: 'Kimi',
    description: 'Moonshot AI Kimi 编程智能体。擅长超长上下文理解，支持中文语境下的代码生成与分析。' },
  'qwen-code':       { binary: 'qwen-code',       detectCommands: ['qwen-code', 'qwen'], presenceDirs: ['~/.qwen/'], cmd: 'qwen-code', args: [], installCmd: 'npm install -g @qwen-code/qwen-code',
    displayName: 'Qwen Code',
    description: '阿里通义千问 Qwen 编程智能体。基于 Qwen 大模型，支持代码生成、审查和多语言编程，深度适配中文开发场景。' },
  'lingma':          { binary: 'lingma',           detectCommands: ['lingma'],      presenceDirs: ['~/.lingma/'], cmd: 'lingma',    args: [],
    displayName: 'Lingma',
    description: '阿里通义灵码智能编程助手。提供代码补全、智能问答、多文件修改和编程智能体能力，支持 MCP 工具扩展。' },
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

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Get the binary name for detection (used by detect endpoint). */
export function getDescriptorBinary(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.binary;
}

/** Get the install command for UI display. */
export function getDescriptorInstallCmd(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.installCmd;
}

/** Get curated display name (overrides registry name if available). */
export function getDescriptorDisplayName(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.displayName;
}

/** Get curated description (overrides registry description if available). */
export function getDescriptorDescription(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.description;
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, AcpAgentOverride> = {};
  let hasEntries = false;

  for (const [key, val] of Object.entries(obj)) {
    if (!isSafeAgentId(key)) continue;
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const entry = val as Record<string, unknown>;
    const override: AcpAgentOverride = {};

    const name = sanitizeOptionalString(entry.name, 80);
    if (name) override.name = name;
    const description = sanitizeOptionalString(entry.description, 500);
    if (description) override.description = description;
    if (typeof entry.command === 'string' && entry.command.trim()) {
      override.command = entry.command.trim();
    }
    if (Array.isArray(entry.args)) {
      override.args = entry.args.filter((a): a is string => typeof a === 'string');
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
    const detectCommands = sanitizeStringArray(entry.detectCommands, 16, 160);
    if (detectCommands) override.detectCommands = detectCommands;
    const presenceDirs = sanitizeStringArray(entry.presenceDirs, 16, 500);
    if (presenceDirs) override.presenceDirs = presenceDirs;
    const installCmd = sanitizeOptionalString(entry.installCmd, 500);
    if (installCmd) override.installCmd = installCmd;
    const adapterMetadata = sanitizeAdapterMetadata(entry.adapterMetadata);
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

function sanitizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function sanitizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxLength))))
    .slice(0, maxItems);
  return result.length > 0 ? result : undefined;
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

function sanitizePositiveInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized <= 0) return undefined;
  return Math.min(normalized, max);
}

function sanitizeAdapterMetadata(value: unknown): AcpAgentAdapterMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const metadata: AcpAgentAdapterMetadata = {};
  if (entry.healthCheck && typeof entry.healthCheck === 'object' && !Array.isArray(entry.healthCheck)) {
    const health = entry.healthCheck as Record<string, unknown>;
    const command = sanitizeOptionalString(health.command, 240);
    const summary = sanitizeOptionalString(health.summary, 300);
    const timeoutMs = sanitizePositiveInteger(health.timeoutMs, 60_000);
    if (command || summary || timeoutMs !== undefined) {
      metadata.healthCheck = {
        ...(command ? { command } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(summary ? { summary } : {}),
      };
    }
  }
  if (Array.isArray(entry.commands)) {
    const commands = entry.commands
      .filter((command): command is Record<string, unknown> => !!command && typeof command === 'object' && !Array.isArray(command))
      .map((command) => {
        const name = sanitizeOptionalString(command.name, 80);
        if (!name) return null;
        const description = sanitizeOptionalString(command.description, 240);
        return {
          name,
          ...(description ? { description } : {}),
        };
      })
      .filter((command): command is AcpAgentAdapterCommandDeclaration => command !== null)
      .slice(0, 50);
    if (commands.length > 0) metadata.commands = commands;
  }
  return metadata.healthCheck || metadata.commands ? metadata : undefined;
}
