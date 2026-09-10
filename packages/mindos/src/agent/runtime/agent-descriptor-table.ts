/**
 * The agent descriptor table: the single source of truth for what MindOS knows
 * about each coding agent before it runs (detection binary, presence
 * directories, ACP launch command, install command, curated name and
 * description). Every other place that needs one of these facts derives it
 * from here: the built-in ACP registry, local detection, the two native
 * runtime definitions (`native-runtimes.ts`), alias matching, `packageName`.
 * Adding an agent means adding one entry (and, if it has alternative ids, one
 * alias); `agent-descriptor-table.test.ts` walks the consumers to prove it.
 */

import type { AcpAgentAdapterMetadata } from './adapter-metadata.js';

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
  /** Non-sensitive adapter contract metadata surfaced in runtime diagnostics. */
  adapterMetadata?: AcpAgentAdapterMetadata;
  /** Curated display name (overrides registry name) */
  displayName?: string;
  /** Curated description (overrides registry description) */
  description?: string;
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
};

/** Resolve an agent ID to its canonical form (idempotent for canonical IDs). */
export function resolveAlias(agentId: string): string {
  return AGENT_ALIASES[agentId] ?? agentId;
}

/** Canonical id first, then every alias that points at it, in table order. */
export function getDescriptorAliases(agentId: string): string[] {
  const canonical = resolveAlias(agentId);
  const aliases = Object.entries(AGENT_ALIASES)
    .filter(([, target]) => target === canonical)
    .map(([alias]) => alias);
  return [canonical, ...aliases];
}

/* ── Canonical Descriptors ─────────────────────────────────────────────── */

/**
 * All known ACP agents with their detection binary, launch command, and install hint.
 * Only canonical entries — aliases are handled by AGENT_ALIASES above.
 */
export const AGENT_DESCRIPTORS: Record<string, AcpAgentDescriptor> = {
  'gemini':          { binary: 'gemini',          detectCommands: ['gemini'],      presenceDirs: ['~/.gemini/'], cmd: 'gemini',    args: ['--acp'], installCmd: 'npm install -g @google/gemini-cli',
    displayName: 'Gemini CLI',
    description: 'Google Gemini 驱动的编程智能体。支持多文件编辑、代码审查、调试和项目级重构，原生集成 Google 搜索实时查询技术文档。' },
  'claude':          { binary: 'claude',          detectCommands: ['claude'],      presenceDirs: ['~/.claude/'], cmd: 'npx',       args: ['--yes', '@agentclientprotocol/claude-agent-acp'], installCmd: 'npm install -g @anthropic-ai/claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic Claude 驱动的编程智能体。擅长复杂推理、长上下文理解和安全代码生成，支持多文件编辑与 agentic 工作流。' },
  'codebuddy-code':  { binary: 'codebuddy',       detectCommands: ['codebuddy'],   presenceDirs: ['~/.codebuddy/'], cmd: 'codebuddy', args: ['--acp'], installCmd: 'npm install -g @tencent-ai/codebuddy-code',
    displayName: 'CodeBuddy Code',
    description: '腾讯云智能编程助手。基于混元大模型，支持代码补全、生成、审查和多文件重构，深度理解中文语境，适配国内开发生态。' },
  'codex-acp':       { binary: 'codex',           detectCommands: ['codex'],       presenceDirs: ['~/.codex/'], cmd: 'npx',       args: ['--yes', '@agentclientprotocol/codex-acp'], installCmd: 'npm install -g @openai/codex',
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
  'opencode':        { binary: 'opencode',        cmd: 'opencode',  args: ['acp'],   installCmd: 'go install github.com/opencode-ai/opencode@latest',
    displayName: 'OpenCode',
    description: '开源终端编程智能体。Go 实现，轻量快速，支持多模型后端和丰富的代码编辑工具。' },
  'kilo':            { binary: 'kilo',            cmd: 'kilo',      args: [],        installCmd: 'npm install -g @kilocode/cli',
    displayName: 'Kilo Code',
    description: 'Kilo Code 编程智能体。开源 VS Code 扩展的 CLI 模式，支持多模型、自动审批和代码差异预览。' },
  'openclaw':        { binary: 'openclaw',        detectCommands: ['openclaw'],    presenceDirs: ['~/.openclaw/'], cmd: 'openclaw',  args: [],
    displayName: 'OpenClaw',
    description: 'OpenClaw 编程智能体。开源 Claude Code 替代方案，支持多模型后端和完整的 agentic 工作流。' },
  'auggie':          { binary: 'auggie',          detectCommands: ['auggie'],      presenceDirs: ['~/.augment/'], cmd: 'auggie',    args: [],
    displayName: 'Auggie',
    description: 'Augment Code 编程智能体。支持代码理解、生成和全仓库上下文感知。' },
  'kimi':            { binary: 'kimi',            detectCommands: ['kimi'],        presenceDirs: ['~/.kimi/'], cmd: 'kimi',      args: ['acp'],
    displayName: 'Kimi',
    description: 'Moonshot AI Kimi 编程智能体。擅长超长上下文理解，支持中文语境下的代码生成与分析。' },
  'qwen-code':       { binary: 'qwen',            detectCommands: ['qwen', 'qwen-code'], presenceDirs: ['~/.qwen/'], cmd: 'qwen',      args: ['--acp'], installCmd: 'npm install -g @qwen-code/qwen-code',
    displayName: 'Qwen Code',
    description: '阿里通义千问 Qwen 编程智能体。基于 Qwen 大模型，支持代码生成、审查和多语言编程，深度适配中文开发场景。' },
  'lingma':          { binary: 'lingma',           detectCommands: ['lingma'],      presenceDirs: ['~/.lingma/'], cmd: 'lingma',    args: [],
    displayName: 'Lingma',
    description: '阿里通义灵码智能编程助手。提供代码补全、智能问答、多文件修改和编程智能体能力，支持 MCP 工具扩展。' },
};

/* ── Derived facts ─────────────────────────────────────────────────────── */

/** The only place that knows an install command encodes an npm package name. */
const NPM_GLOBAL_INSTALL_PATTERN = /npm install -g (.+)/;

export function packageNameFromInstallCmd(installCmd: string | undefined): string | undefined {
  if (typeof installCmd !== 'string') return undefined;
  const packageName = installCmd.match(NPM_GLOBAL_INSTALL_PATTERN)?.[1]?.trim();
  return packageName || undefined;
}

/** Get the binary name for detection (used by detect endpoint). */
export function getDescriptorBinary(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.binary;
}

/** Get the install command for UI display. */
export function getDescriptorInstallCmd(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.installCmd;
}

/** npm package behind the install command, when it is an npm global install. */
export function getDescriptorPackageName(agentId: string): string | undefined {
  return packageNameFromInstallCmd(getDescriptorInstallCmd(agentId));
}

/** Get curated display name (overrides registry name if available). */
export function getDescriptorDisplayName(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.displayName;
}

/** Get curated description (overrides registry description if available). */
export function getDescriptorDescription(agentId: string): string | undefined {
  return AGENT_DESCRIPTORS[resolveAlias(agentId)]?.description;
}
