/**
 * Shared types for the agent-config layer.
 *
 * Every downstream agent MindOS can connect to (Claude Code, Cursor, Codex,
 * Hermes, ...) is described by one `AgentConfigDef`: where its MCP config
 * lives, which key holds the servers map, which text format the file uses,
 * and how to tell whether the agent is installed on this machine. The
 * server handlers, the Web host and the CLI (through the generated bundle in
 * `bin/lib/generated/agent-config.mjs`) all consume these same types.
 */

export type AgentConfigFormat = 'json' | 'toml' | 'yaml';

export type AgentConfigScope = 'global' | 'project';

export type AgentConfigTransport = 'stdio' | 'http';

export type AgentConfigEntryStyle = 'standard' | 'kilo' | 'codex';

/** Config-location half of an agent definition (what `mcp-install` needs to write a file). */
export type AgentConfigLocationDef = {
  name: string;
  /** Relative project-scoped config path (`.mcp.json`), or null when the agent has no project scope. */
  project: string | null;
  /** Global config path; `~` is expanded against the caller's home directory. */
  global: string;
  /** Additional discovery paths. Same-stem JSON/JSONC alternatives may be edited in place; legacy paths are read-only. */
  projectReadAlso?: string[];
  globalReadAlso?: string[];
  /** Key of the servers map: `mcpServers`, `mcp_servers`, `mcp`, `servers`. */
  key: string;
  preferredTransport: AgentConfigTransport;
  /** Config file format; JSON / JSONC when omitted. */
  format?: AgentConfigFormat;
  /** Global config only: dotted path of a nested container that replaces `key` (CoPaw `mcp.clients`). */
  globalNestedKey?: string;
  /** Agent-specific MCP entry shape. Defaults to the common Claude / Cursor style. */
  entryStyle?: AgentConfigEntryStyle;
};

/** Full registry definition: config location plus presence probes and skill directory. */
export type AgentConfigDef = AgentConfigLocationDef & {
  /** CLI binary whose presence on PATH marks the agent as installed. */
  presenceCli?: string;
  /** Data directories (or files) whose existence marks the agent as installed. */
  presenceDirs?: string[];
  /** Agent-specific skills workspace when it differs from `<hidden root>/skills`. */
  skillDir?: string;
};

/** A user-registered agent as persisted in settings (`customAgents[]`). */
export type CustomAgentConfigDef = {
  name: string;
  key: string;
  baseDir: string;
  global: string;
  project?: string | null;
  configKey: string;
  format: 'json' | 'toml';
  preferredTransport: AgentConfigTransport;
  presenceDirs: string[];
  presenceCli?: string;
  globalNestedKey?: string;
  entryStyle?: AgentConfigEntryStyle;
  skillDir?: string;
};

export type SkillInstallMode = 'universal' | 'additional' | 'unsupported';

export type SkillAgentRegistration = {
  mode: SkillInstallMode;
  /** `npx skills -a` value for additional agents. */
  skillAgentName?: string;
};

export type SkillWorkspaceProfile = {
  mode: SkillInstallMode;
  skillAgentName?: string;
  workspacePath: string;
};

/** Where one MCP server entry lives inside an agent config file. */
export type McpServerEntryLocation = {
  format: AgentConfigFormat;
  /** Key of the servers map: `mcpServers`, `mcp_servers`, `mcp`, ... */
  sectionKey: string;
  /** JSON only: dot path of a nested container that replaces `sectionKey` (CoPaw `mcp.clients`). */
  nestedPath?: string;
};

export type SkillRootSource = 'builtin' | 'user';
export type SkillRootOrigin = 'app-builtin' | 'mindos-user' | 'mindos-global' | 'agents-global' | 'custom' | 'project-builtin';

/** A directory MindOS scans for skills (`<root>/<skill>/SKILL.md`). */
export type SkillRoot = {
  path: string;
  source: SkillRootSource;
  origin: SkillRootOrigin;
  editable: boolean;
};

export type AgentDirent = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

export type AgentFileStat = {
  mtimeMs: number;
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
};

/**
 * Filesystem / process probes the adapter layer uses. Every field is
 * optional; the defaults are the real `node:fs` / `which` calls. Hosts and
 * tests inject their own so behaviour stays observable (the Web host routes
 * them through its own `fs` import so `vi.spyOn(fs, ...)` keeps working).
 * Injecting any probe also disables the process-wide presence and
 * config-read caches, which only make sense against the real filesystem.
 */
export type AgentConfigProbes = {
  homeDir?: string;
  /** Base directory for relative project-scoped config paths; never `process.cwd()`. */
  projectRoot?: string;
  pathExists?(path: string): boolean;
  readTextFile?(path: string): string;
  readDir?(path: string): AgentDirent[];
  stat?(path: string): AgentFileStat;
  commandExists?(command: string): boolean;
  now?(): number;
};
