import type { Messages } from '@/lib/i18n';
import type { Provider } from '@/lib/custom-endpoints';

// ─── i18n type aliases ───────────────────────────────────────────────────────
export type SetupMessages = Messages['setup'];
export type McpMessages = Messages['settings']['mcp'];

// ─── Template ────────────────────────────────────────────────────────────────
export type Template = 'en' | 'zh' | 'empty' | '';

// ─── Setup state ─────────────────────────────────────────────────────────────

/** Provider with optional apiKeyMask for displaying masked existing keys */
export type SetupProvider = Provider & { apiKeyMask?: string };

export interface SetupState {
  mindRoot: string;
  template: Template;
  activeProvider: string;       // Provider.id ("p_...") or 'skip'
  providers: SetupProvider[];   // Unified Provider[] format (same as config.json)
  webPort: number;
  mcpPort: number;
  authToken: string;
  webPassword: string;
}

// ─── Connection mode (CLI / MCP toggle) ──────────────────────────────────────
export interface ConnectionMode {
  cli: boolean;
  mcp: boolean;
}

// ─── Port check ──────────────────────────────────────────────────────────────
export interface PortStatus {
  checking: boolean;
  available: boolean | null;
  isSelf: boolean;
  suggestion: number | null;
}

// ─── Agent types ─────────────────────────────────────────────────────────────
export interface AgentEntry {
  key: string;
  name: string;
  present: boolean;
  installed: boolean;
  scope?: string;
  hasProjectScope: boolean;
  hasGlobalScope: boolean;
  preferredTransport: 'stdio' | 'http';
}

export type AgentInstallState = 'pending' | 'installing' | 'ok' | 'error';

export interface AgentInstallStatus {
  state: AgentInstallState;
  message?: string;
  transport?: string;
  verified?: boolean;
  verifyError?: string;
}
