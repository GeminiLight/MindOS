import type { Locale, Messages } from '@/lib/i18n';
import type React from 'react';
import type { Provider } from '@/lib/custom-endpoints';
import type { AgentRuntimeEnvironmentSettings } from '@geminilight/mindos/agent-runtime/runtime-env';

export interface AiSettings {
  activeProvider: string;
  providers: Provider[];
}

export interface AgentSettings {
  maxSteps?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  contextStrategy?: 'auto' | 'off';
  reconnectRetries?: number;
}

export interface SettingsData {
  ai: AiSettings;
  agent?: AgentSettings;
  embedding?: {
    enabled: boolean;
    provider: 'local' | 'api';
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  embeddingStatus?: {
    enabled: boolean;
    ready: boolean;
    building: boolean;
    docCount: number;
  };
  webSearch?: {
    provider: string;
    exaApiKey: string;
    perplexityApiKey: string;
    geminiApiKey: string;
  };
  mindRoot: string;
  webPassword?: string;
  authToken?: string;   // masked: first-xxxx-••••-last pattern
  allowNetworkAccess?: boolean;
  port?: number;
  mcpPort?: number;
  skillPaths?: {
    enableAgentsDir?: boolean;
    custom?: string[];
  };
  agentRuntimeEnv?: AgentRuntimeEnvironmentSettings;
  connectionMode?: {
    cli: boolean;
    mcp: boolean;
  };
  envOverrides?: Record<string, boolean>;
  envValues?: Record<string, string>;
}

export type Tab = 'ai' | 'appearance' | 'knowledge' | 'plugins' | 'mcp' | 'sync' | 'update' | 'uninstall';

export const CONTENT_WIDTH_DEFAULT = '80%';
export const CONTENT_WIDTH_MIN = 50;
export const CONTENT_WIDTH_MAX = 100;
export const CONTENT_WIDTH_STEP = 5;

export const FONT_SIZES = [
  { value: '14px', label: '14', numericValue: 14 },
  { value: '15px', label: '15', numericValue: 15, isDefault: true },
  { value: '16px', label: '16', numericValue: 16 },
  { value: '17px', label: '17', numericValue: 17 },
];

export const FONTS = [
  { value: 'lora', label: 'Lora', category: 'Serif', style: { fontFamily: 'Lora, Georgia, serif' } },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', category: 'Sans', style: { fontFamily: "'IBM Plex Sans', sans-serif" } },
  { value: 'inter', label: 'Inter', category: 'Sans', style: { fontFamily: 'var(--font-inter), sans-serif' } },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono', category: 'Mono', style: { fontFamily: "'IBM Plex Mono', monospace" } },
];

/* ── MCP Types ────────────────────────────────────────────────── */

export interface ConnectionMode {
  cli: boolean;
  mcp: boolean;
}

export interface McpStatus {
  running: boolean;
  transport: string;
  endpoint: string;
  port: number;
  toolCount: number;
  authConfigured: boolean;
  maskedToken?: string;
  localIP?: string | null;
  connectionMode?: ConnectionMode;
}

export interface AgentInfo {
  key: string;
  name: string;
  present: boolean;
  installed: boolean;
  scope?: string;
  transport?: string;
  configPath?: string;
  hasProjectScope: boolean;
  hasGlobalScope: boolean;
  preferredTransport: 'stdio' | 'http';
  // Snippet generation fields
  format: 'json' | 'toml' | 'yaml';
  configKey: string;
  globalNestedKey?: string;
  entryStyle?: 'standard' | 'kilo';
  globalPath: string;
  projectPath?: string | null;
  skillMode?: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
  skillWorkspacePath?: string;
  hiddenRootPath?: string;
  hiddenRootPresent?: boolean;
  runtimeConversationSignal?: boolean;
  runtimeUsageSignal?: boolean;
  runtimeLastActivityAt?: string;
  configuredMcpServers?: string[];
  configuredMcpServerCount?: number;
  configuredMcpSources?: string[];
  installedSkillNames?: string[];
  installedSkillCount?: number;
  installedSkillSourcePath?: string;
  skillCapabilities?: {
    mode: 'universal' | 'additional' | 'unsupported';
    workspacePath: string;
    visibility: 'global' | 'agent' | 'manual';
    nativeSkillScope: 'none' | 'global' | 'native-private';
    canLinkMindosSkills: boolean;
    canReceiveLinkedSkills: boolean;
    canExportNativeSkills: boolean;
    linkStrategy: 'symlink' | 'copy' | 'manual' | 'unsupported';
  };
  /** True for user-defined agents (not built-in). */
  isCustom?: boolean;
  /** Base directory for custom agents (used for UI display). */
  customBaseDir?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  /** Which skill root the body lives in (e.g. 'app-builtin', 'agents-global', 'custom'). */
  origin?: string;
  enabled: boolean;
  editable: boolean;
}

/** Roots owned by an external agent (or the npx skills ecosystem) — read-only in MindOS. */
export function isAgentOwnedSkillOrigin(origin: string | undefined): boolean {
  return origin === 'agents-global' || origin === 'custom';
}

/* ── Skill × Agent matrix (mirrors GET /api/skills/matrix) ────── */

/** External agent cells use linked/copied/broken/conflict/native-disabled/none; the MindOS self column uses enabled/disabled. */
export type SkillMatrixCellStatus =
  | 'native-disabled'
  | 'linked'
  | 'copied'
  | 'broken'
  | 'conflict'
  | 'none'
  | 'enabled'
  | 'disabled';

export interface SkillMatrixAgent {
  key: string;
  name: string;
  /** First entry is always { key: 'mindos', mode: 'self' }; the rest are detected skill-capable agents. */
  mode: 'self' | 'universal' | 'additional';
  skillDir?: string;
}

export interface SkillMatrixCell {
  enabled: boolean;
  status: SkillMatrixCellStatus;
}

export interface SkillMatrixSkill {
  name: string;
  description: string;
  source: 'builtin' | 'user';
  origin: string;
  path: string;
}

export interface SkillMatrix {
  skills: SkillMatrixSkill[];
  agents: SkillMatrixAgent[];
  state: Record<string, Record<string, boolean>>;
  cells: Record<string, Record<string, SkillMatrixCell>>;
}

export interface SyncStatus {
  enabled: boolean;
  configured?: boolean;
  needsSetup?: boolean;
  provider?: string;
  remote?: string;
  branch?: string;
  lastSync?: string | null;
  lastPull?: string | null;
  unpushed?: string;
  conflicts?: Array<{
    file: string;
    time?: string;
    noBackup?: boolean;
    localExists?: boolean;
    remoteExists?: boolean;
  }>;
  lastError?: string | null;
  autoCommitInterval?: number;
  autoPullInterval?: number;
}

export interface McpTabProps {
  t: Messages;
}

export type SettingsMcpMessages = Messages['settings']['mcp'];

export interface AppearanceTabProps {
  font: string;
  setFont: (v: string) => void;
  fontSize: string;
  setFontSize: (v: string) => void;
  contentWidth: string;
  setContentWidth: (v: string) => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  locale: Locale;
  setLocale: (v: Locale) => void;
  t: Messages;
}

export interface AiTabProps {
  data: SettingsData;
  setData: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  updateAi: (patch: Partial<AiSettings>) => void;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  t: Messages;
}

export interface KnowledgeTabProps {
  data: SettingsData;
  setData: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  t: Messages;
}

export interface PluginsTabProps {
  pluginStates: Record<string, boolean>;
  setPluginStates: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  t: Messages;
  mindRoot?: string;
}

export interface SyncTabProps {
  t: Messages;
  visible?: boolean;
}

export interface McpAgentInstallProps {
  agents: AgentInfo[];
  t: Messages;
  onRefresh: () => void;
  mode?: 'cli' | 'mcp';
  activeSkillName?: string;
  status?: McpStatus | null;
}

export interface McpSkillsSectionProps {
  t: Messages;
}
