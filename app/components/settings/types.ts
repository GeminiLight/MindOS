import type { Locale, Messages } from '@/lib/i18n';
import type React from 'react';

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AiSettings {
  provider: 'anthropic' | 'openai';
  providers: {
    anthropic?: ProviderConfig;
    openai?: ProviderConfig;
  };
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
  mindRoot: string;
  webPassword?: string;
  authToken?: string;   // masked: first-xxxx-••••-last pattern
  mcpPort?: number;
  envOverrides?: Record<string, boolean>;
  envValues?: Record<string, string>;
}

export type Tab = 'ai' | 'appearance' | 'knowledge' | 'mcp' | 'sync' | 'update' | 'uninstall';

export const CONTENT_WIDTHS = [
  { value: '680px', label: 'Narrow', width: 42 },
  { value: '780px', label: 'Default', width: 56 },
  { value: '960px', label: 'Wide', width: 75 },
  { value: '100%', label: 'Full', width: 100 },
];

export const FONT_SIZES = [
  { value: '14px', label: '14', numericValue: 14 },
  { value: '15px', label: '15', numericValue: 15, isDefault: true },
  { value: '16px', label: '16', numericValue: 16 },
  { value: '17px', label: '17', numericValue: 17 },
];

export const FONTS = [
  { value: 'lora', label: 'Lora', category: 'Serif', style: { fontFamily: 'Lora, Georgia, serif' } },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', category: 'Sans', style: { fontFamily: "'IBM Plex Sans', sans-serif" } },
  { value: 'geist', label: 'Geist', category: 'Sans', style: { fontFamily: 'var(--font-geist-sans), sans-serif' } },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono', category: 'Mono', style: { fontFamily: "'IBM Plex Mono', monospace" } },
];

/* ── MCP Types ────────────────────────────────────────────────── */

export interface McpStatus {
  running: boolean;
  transport: string;
  endpoint: string;
  port: number;
  toolCount: number;
  authConfigured: boolean;
  maskedToken?: string;
  authToken?: string;
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
  format: 'json' | 'toml';
  configKey: string;
  globalNestedKey?: string;
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
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  enabled: boolean;
  editable: boolean;
}

/** 🟢 MINOR #7: Moved from SyncTab.tsx for consistency */
export interface SyncStatus {
  enabled: boolean;
  provider?: string;
  remote?: string;
  branch?: string;
  lastSync?: string | null;
  lastPull?: string | null;
  unpushed?: string;
  conflicts?: Array<{ file: string; time: string }>;
  lastError?: string | null;
  autoCommitInterval?: number;
  autoPullInterval?: number;
}

export interface McpTabProps {
  t: Messages;
}

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
}

export interface SyncTabProps {
  t: Messages;
}

export interface McpServerStatusProps {
  status: McpStatus | null;
  agents: AgentInfo[];
  t: Messages;
}

export interface McpAgentInstallProps {
  agents: AgentInfo[];
  t: Messages;
  onRefresh: () => void;
}

export interface McpSkillsSectionProps {
  t: Messages;
}

export interface ShortcutsTabProps {
  t: Messages;
}
