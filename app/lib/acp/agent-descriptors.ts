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
  /** Curated display name (overrides registry name) */
  displayName?: string;
  /** Curated description (overrides registry description) */
  description?: string;
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
  // Gemini CLI — Google's AI coding agent
  'gemini':          { binary: 'gemini',          cmd: 'gemini',    args: ['--experimental-acp'], installCmd: 'npm install -g @google/gemini-cli',
    displayName: 'Gemini CLI',
    description: 'Google Gemini 驱动的编程智能体。支持多文件编辑、代码审查、调试和项目级重构，原生集成 Google 搜索实时查询技术文档。' },
  'gemini-cli':      { binary: 'gemini',          cmd: 'gemini',    args: ['--experimental-acp'], installCmd: 'npm install -g @google/gemini-cli',
    displayName: 'Gemini CLI',
    description: 'Google Gemini 驱动的编程智能体。支持多文件编辑、代码审查、调试和项目级重构，原生集成 Google 搜索实时查询技术文档。' },
  // Claude Code — Anthropic's AI coding agent
  'claude':          { binary: 'claude',          cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic Claude 驱动的编程智能体。擅长复杂推理、长上下文理解和安全代码生成，支持多文件编辑与 agentic 工作流。' },
  'claude-code':     { binary: 'claude',          cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic Claude 驱动的编程智能体。擅长复杂推理、长上下文理解和安全代码生成，支持多文件编辑与 agentic 工作流。' },
  'claude-acp':      { binary: 'claude',          cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic Claude 驱动的编程智能体。擅长复杂推理、长上下文理解和安全代码生成，支持多文件编辑与 agentic 工作流。' },
  // CodeBuddy Code — Tencent Cloud's AI coding agent
  'codebuddy-code':  { binary: 'codebuddy',       cmd: 'codebuddy', args: ['--acp'], installCmd: 'npm install -g @tencent-ai/codebuddy-code',
    displayName: 'CodeBuddy Code',
    description: '腾讯云智能编程助手。基于混元大模型，支持代码补全、生成、审查和多文件重构，深度理解中文语境，适配国内开发生态。' },
  'codebuddy':       { binary: 'codebuddy',       cmd: 'codebuddy', args: ['--acp'], installCmd: 'npm install -g @tencent-ai/codebuddy-code',
    displayName: 'CodeBuddy Code',
    description: '腾讯云智能编程助手。基于混元大模型，支持代码补全、生成、审查和多文件重构，深度理解中文语境，适配国内开发生态。' },
  // Codex — OpenAI's coding agent
  'codex-acp':       { binary: 'codex',           cmd: 'codex',     args: [],        installCmd: 'npm install -g @openai/codex',
    displayName: 'Codex',
    description: 'OpenAI Codex 编程智能体。基于 GPT 系列模型，擅长代码生成、自动化任务和多语言编程支持。' },
  'codex':           { binary: 'codex',           cmd: 'codex',     args: [],        installCmd: 'npm install -g @openai/codex',
    displayName: 'Codex',
    description: 'OpenAI Codex 编程智能体。基于 GPT 系列模型，擅长代码生成、自动化任务和多语言编程支持。' },
  // Cursor — AI-first code editor agent
  'cursor':          { binary: 'cursor',          cmd: 'cursor',    args: [],
    displayName: 'Cursor',
    description: 'Cursor AI 编程智能体。AI-first 代码编辑器的 CLI 模式，支持上下文感知的代码编辑、Tab 补全和多文件协同修改。' },
  'cline':           { binary: 'cline',           cmd: 'cline',     args: [],        installCmd: 'npm install -g cline',
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
  'openclaw':        { binary: 'openclaw',        cmd: 'openclaw',  args: [],
    displayName: 'OpenClaw',
    description: 'OpenClaw 编程智能体。开源 Claude Code 替代方案，支持多模型后端和完整的 agentic 工作流。' },
  'pi':              { binary: 'pi',              cmd: 'pi',        args: [],
    displayName: 'Pi Agent',
    description: 'Pi Agent 编程智能体。轻量级终端编程助手。' },
  'pi-acp':          { binary: 'pi',              cmd: 'pi',        args: [],
    displayName: 'Pi Agent',
    description: 'Pi Agent 编程智能体。轻量级终端编程助手。' },
  'auggie':          { binary: 'auggie',          cmd: 'auggie',    args: [],
    displayName: 'Auggie',
    description: 'Augment Code 编程智能体。支持代码理解、生成和全仓库上下文感知。' },
  'iflow':           { binary: 'iflow',           cmd: 'iflow',     args: [],
    displayName: 'iFlow',
    description: 'iFlow 编程智能体。AI 驱动的工作流自动化工具。' },
  'kimi':            { binary: 'kimi',            cmd: 'kimi',      args: [],
    displayName: 'Kimi',
    description: 'Moonshot AI Kimi 编程智能体。擅长超长上下文理解，支持中文语境下的代码生成与分析。' },
  'qwen-code':       { binary: 'qwen-code',       cmd: 'qwen-code', args: [], installCmd: 'npm install -g @qwen-code/qwen-code',
    displayName: 'Qwen Code',
    description: '阿里通义千问 Qwen 编程智能体。基于 Qwen 大模型，支持代码生成、审查和多语言编程，深度适配中文开发场景。' },
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

/** Get curated display name (overrides registry name if available). */
export function getDescriptorDisplayName(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[agentId]?.displayName;
}

/** Get curated description (overrides registry description if available). */
export function getDescriptorDescription(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[agentId]?.description;
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
